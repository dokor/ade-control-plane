import { parseAdeHumanDecisionResult, parseEnvelope, type AdeHumanDecision, type AdeHumanDecisionResult } from "@ade-control-plane/ade-client";
import type { AgentUsageMetrics, JsonObject, ProjectRecord } from "@ade-control-plane/database";

import type { CommandOutput, CommandResult, CommandRunner } from "./v0/CommandRunner.js";
import type { AgentExecutor } from "./AgentExecutor.js";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { redactDiagnostic } from "./v0/ExecutionDiagnostics.js";

export type AdeDeliveryFailureCode =
  | "ADE_RUNTIME_MISMATCH"
  | "ADE_CONFIG_MISSING"
  | "ADE_CONFIG_INVALID"
  | "ADE_CONTEXT_FAILED"
  | "ADE_SETUP_INCOMPLETE"
  | "ADE_SETUP_INVALID"
  | "ADE_DELIVERY_PLAN_UNSUPPORTED"
  | "ADE_DECISION_FAILED"
  | "ADE_DECISION_INVALID"
  | "ADE_DETERMINISTIC_REVIEW_FAILED"
  | "ADE_PROFILE_REVIEW_BLOCKED"
  | "ADE_PROFILE_REVIEW_FAILED";

const ADE_SETUP_CONTRACT_VERSION = "ade.project-setup/v1";
export const ADE_DELIVERY_PLAN_VERSION = "ade.delivery-plan/v1";

export interface AdeDeliveryPlan {
  version: typeof ADE_DELIVERY_PLAN_VERSION;
  action: "enrich" | "develop" | "wait" | "none";
  reason: string;
  implementationProfile: string;
  reviews: readonly { profile: string; instructions: string; selectionReason: string }[];
  validationRuleIds: readonly string[];
  maximumCorrectionAttempts: number;
  correctionInstructions: string | null;
  publicationReady: boolean;
}

export interface AdeProfileFinding {
  profile: string;
  severity: "info" | "warning" | "error";
  category: string;
  summary: string;
  blocking: boolean;
  status: "open" | "fixed" | "accepted-risk" | "not-applicable";
  attempt: number;
}

export interface AdeDeliveryProvenance {
  runtimeVersion: string;
  setupContractVersion: string;
  configStatus: "validated";
  contextStatus: "fresh";
  contextProfile: string;
  rulePackIds: readonly string[];
  selectedProfiles: readonly string[];
  selectedProfileReasons: readonly string[];
  deterministicReview: "passed";
  profileReview: "passed";
  profileReviewAttempts: number;
}

export interface AdeDeliveryReviewResult {
  provenance: AdeDeliveryProvenance;
  findings: readonly AdeProfileFinding[];
  usage: readonly AgentUsageMetrics[];
}

export interface AdeDeliveryPreparation {
  runtimeVersion: string;
  setupContractVersion: string;
  contextProfile: string;
  rulePackIds: readonly string[];
}

export interface AdeSetupEvaluation {
  runtimeVersion: string;
  setupContractVersion: string;
  readiness: "ready" | "incomplete" | "invalid";
  missingRequiredIds: readonly string[];
  diagnostics: readonly { id: string; status: string; criticality: string; detail: string; remediation: string }[];
  configurationErrors: readonly string[];
  missingExecutionCapabilityIds: readonly string[];
  classification: "absent" | "compatible" | "outdated" | "incomplete" | "invalid";
  declaredDependency: string | null;
}

export interface AdeDeliveryWorkContext {
  project: ProjectRecord;
  source: "prompt" | "github-issue";
  prompt: string;
  issueNumber?: number;
  issueTitle?: string;
  affectedPaths?: readonly string[];
}

export interface AdeDeliveryRuntimeOptions {
  commands: CommandRunner;
  executable?: string;
  expectedVersion?: string;
  environment?: Readonly<Record<string, string>>;
}

export class AdeDeliveryError extends Error {
  public constructor(
    public readonly code: AdeDeliveryFailureCode,
    public readonly safeSummary: string,
  ) {
    super(safeSummary);
    this.name = "AdeDeliveryError";
  }
}

/**
 * Shared ADE boundary for every mutating delivery path. It deliberately uses
 * the released CLI surface so the worker cannot accidentally load a second ADE
 * implementation or silently diverge from the image runtime.
 */
export class AdeDeliveryRuntime {
  private readonly executable: string;
  private readonly expectedVersion: string;

  public constructor(private readonly options: AdeDeliveryRuntimeOptions) {
    this.executable = options.executable ?? "ade";
    this.expectedVersion = options.expectedVersion ?? "unknown";
  }

  public async prepare(input: {
    cwd: string;
    work: AdeDeliveryWorkContext;
    contextProfile?: string;
    signal?: AbortSignal;
    onOutput?(output: CommandOutput): void | Promise<void>;
    onSetupEvaluation?(setup: AdeSetupEvaluation): void | Promise<void>;
  }): Promise<AdeDeliveryPreparation> {
    const runtimeVersion = await this.detectVersion(input);
    await this.runAde(input, ["config", "validate"], "ADE config validation", "ADE_CONFIG_INVALID");
    const contextProfile = input.contextProfile ?? configuredContextProfile(input.work.project) ?? "normal";
    await this.runAde(input, ["context", "generate"], "ADE project context generation", "ADE_CONTEXT_FAILED");
    await this.runAde(input, ["context", "pack", contextProfile], `ADE ${contextProfile} context pack`, "ADE_CONTEXT_FAILED");
    const evaluation = await this.inspectSetup(input, runtimeVersion);
    await input.onSetupEvaluation?.(evaluation);
    this.requireReadySetup(evaluation);
    return {
      runtimeVersion,
      setupContractVersion: evaluation.setupContractVersion,
      contextProfile,
      rulePackIds: configuredRulePacks(input.work.project),
    };
  }

  /** Runs ADE's read-only, versioned setup report in a runner checkout. */
  public async inspectSetup(
    input: { cwd: string; work: AdeDeliveryWorkContext; signal?: AbortSignal },
    detectedRuntimeVersion?: string,
  ): Promise<AdeSetupEvaluation> {
    const runtimeVersion = detectedRuntimeVersion ?? await this.detectVersion(input);
    let result: CommandResult;
    try {
      result = await this.options.commands.run({
        executable: this.executable,
        args: ["setup", "check", "--json"],
        cwd: input.cwd,
        ...(this.options.environment ? { env: this.options.environment } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch {
      throw new AdeDeliveryError("ADE_SETUP_INVALID", "ADE project setup could not be evaluated.");
    }
    const evaluation = parseSetupEvaluation(result.stdout);
    if (!evaluation || evaluation.version !== ADE_SETUP_CONTRACT_VERSION) {
      throw new AdeDeliveryError("ADE_SETUP_INVALID", "ADE returned an unsupported project setup contract.");
    }
    if (evaluation.adeVersion && parseVersion(evaluation.adeVersion) !== runtimeVersion) {
      throw new AdeDeliveryError("ADE_RUNTIME_MISMATCH", "The ADE setup report does not match the detected worker runtime.");
    }
    if (result.exitCode !== 0 && evaluation.readiness === "ready") {
      throw new AdeDeliveryError("ADE_SETUP_INVALID", "ADE project setup returned an inconsistent readiness result.");
    }
    const declaredDependency = await readDeclaredAdeDependency(input.cwd);
    const olderDeclaration = declaredDependency !== null && isOlderDeclaration(declaredDependency, runtimeVersion);
    return {
      runtimeVersion,
      setupContractVersion: evaluation.version,
      readiness: evaluation.readiness,
      missingRequiredIds: evaluation.missingRequiredIds.filter(isSafeSetupId).slice(0, 20),
      diagnostics: evaluation.diagnostics,
      configurationErrors: evaluation.configurationErrors,
      missingExecutionCapabilityIds: evaluation.missingExecutionCapabilityIds,
      declaredDependency,
      classification: evaluation.readiness === "ready" ? "compatible" : olderDeclaration ? "outdated"
        : evaluation.missingRequiredIds.includes("config.ade-config") || evaluation.missingRequiredIds.includes("config.file") ? "absent" : evaluation.readiness,
    };
  }

  /** Negotiates ADE's repository-owned delivery contract over stdin. */
  public async resolveDeliveryPlan(input: { cwd: string; issue: { number: number; title: string; body: string; labels: readonly string[]; state: "open" | "closed"; url: string }; signal?: AbortSignal }): Promise<AdeDeliveryPlan> {
    let result: CommandResult;
    try {
      result = await this.options.commands.run({
        executable: this.executable, args: ["delivery", "plan", "--json"], cwd: input.cwd,
        stdin: JSON.stringify({ issue: input.issue, negotiation: { acceptedVersions: [ADE_DELIVERY_PLAN_VERSION], requiredCapabilities: ["implementation-context", "deterministic-validation", "specialist-review", "profile-invocations", "correction-and-rereview", "human-publication-gate"] } }),
        ...(this.options.environment ? { env: this.options.environment } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch {
      throw new AdeDeliveryError("ADE_DELIVERY_PLAN_UNSUPPORTED", "The installed ADE runtime could not negotiate the required delivery-plan contract.");
    }
    const plan = parseDeliveryPlan(result.stdout);
    if (result.exitCode !== 0 || !plan) {
      throw new AdeDeliveryError("ADE_DELIVERY_PLAN_UNSUPPORTED", deliveryPlanCompatibilityReason(result.stdout) ?? "The installed ADE runtime does not provide the required delivery-plan contract.");
    }
    return plan;
  }

  /** Applies a previously resolved decision through ADE's versioned control-plane contract. */
  public async applyHumanDecision(input: {
    cwd: string;
    projectRef: string;
    decision: AdeHumanDecision;
    signal?: AbortSignal;
  }): Promise<AdeHumanDecisionResult> {
    let result: CommandResult;
    try {
      result = await this.runCommand(
        { cwd: input.cwd, work: {} as AdeDeliveryWorkContext, ...(input.signal ? { signal: input.signal } : {}) },
        "ADE human decision",
        {
          executable: this.executable,
          args: [
            "control-plane", "apply-decision", "--project", input.projectRef, "--json",
            "--input-json", JSON.stringify(input.decision),
          ],
        },
      );
    } catch (error) {
      if (error instanceof AdeDeliveryError && error.code === "ADE_CONFIG_INVALID") {
        throw new AdeDeliveryError("ADE_DECISION_FAILED", "ADE could not apply the resolved human decision.");
      }
      throw error;
    }
    try {
      return parseAdeHumanDecisionResult(parseEnvelope(JSON.parse(result.stdout), "apply-decision"));
    } catch (error) {
      if (error instanceof AdeDeliveryError) throw error;
      throw new AdeDeliveryError("ADE_DECISION_INVALID", "ADE returned an invalid human decision result.");
    }
  }

  public async runPostAgentGates(input: {
    cwd: string;
    work: AdeDeliveryWorkContext;
    agentExecutor: AgentExecutor;
    prepared: AdeDeliveryPreparation;
    plan: AdeDeliveryPlan;
    signal?: AbortSignal;
    onOutput?(output: CommandOutput): void | Promise<void>;
  }): Promise<AdeDeliveryReviewResult> {
    const selectedProfiles = input.plan.reviews.map((review) => review.profile);
    const instructionsByProfile = new Map(input.plan.reviews.map((review) => [review.profile, review.instructions]));
    const findings: AdeProfileFinding[] = [];
    const usage: AgentUsageMetrics[] = [];
    let attempt = 0;

    // Zero means no correction retry, never "skip the first validation pass".
    const maximumAttempts = Math.max(1, input.plan.maximumCorrectionAttempts);
    while (attempt < maximumAttempts) {
      attempt += 1;
      await this.runCommand(input, "git add", {
        executable: "git",
        args: ["-c", "core.hooksPath=/dev/null", "add", "--all"],
      });
      await this.runAde(input, ["review", "--staged", "--json"], "ADE deterministic staged review", "ADE_DETERMINISTIC_REVIEW_FAILED");

      const pass = await this.runProfileReviews(input, selectedProfiles, attempt, findings, usage, instructionsByProfile);
      if (pass) {
        return {
          provenance: {
            runtimeVersion: input.prepared.runtimeVersion,
            setupContractVersion: input.prepared.setupContractVersion,
            configStatus: "validated",
            contextStatus: "fresh",
            contextProfile: input.prepared.contextProfile,
            rulePackIds: input.prepared.rulePackIds,
            selectedProfiles,
            selectedProfileReasons: input.plan.reviews.map((review) => `${review.profile}: ${review.selectionReason}`),
            deterministicReview: "passed",
            profileReview: "passed",
            profileReviewAttempts: attempt,
          },
          findings,
          usage,
        };
      }

      if (attempt >= maximumAttempts) {
        throw new AdeDeliveryError("ADE_PROFILE_REVIEW_BLOCKED", "Required ADE profile reviews remain blocking after the allowed correction attempts.");
      }

      const correction = await input.agentExecutor.execute({
        cwd: input.cwd,
        prompt: `${input.plan.correctionInstructions ?? ""}\n\nBlocking ADE findings:\n${findings.filter((finding) => finding.blocking).map((finding) => `- [${finding.profile}] ${finding.category}: ${finding.summary}`).join("\n")}`,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onOutput ? { onOutput: input.onOutput } : {}),
      });
      if (correction.usage) usage.push(correction.usage);
      if (correction.exitCode !== 0) {
        throw new AdeDeliveryError("ADE_PROFILE_REVIEW_FAILED", "The delivery agent could not apply the required ADE review corrections.");
      }
    }

    throw new AdeDeliveryError("ADE_PROFILE_REVIEW_BLOCKED", "ADE profile review did not reach a passing state.");
  }

  public static provenanceSummary(provenance: AdeDeliveryProvenance): Record<string, string | number> {
    return {
      adeRuntimeVersion: provenance.runtimeVersion,
      adeSetupContractVersion: provenance.setupContractVersion,
      adeConfigStatus: provenance.configStatus,
      adeContextStatus: provenance.contextStatus,
      adeContextProfile: provenance.contextProfile,
      adeRulePackIds: provenance.rulePackIds.join(",").slice(0, 500),
      adeSelectedProfiles: provenance.selectedProfiles.join(",").slice(0, 500),
      adeSelectedProfileReasons: provenance.selectedProfileReasons.join(" | ").slice(0, 500),
      adeDeterministicReview: provenance.deterministicReview,
      adeProfileReview: provenance.profileReview,
      adeProfileReviewAttempts: provenance.profileReviewAttempts,
    };
  }

  private async detectVersion(input: {
    cwd: string;
    work: AdeDeliveryWorkContext;
    signal?: AbortSignal;
    onOutput?(output: CommandOutput): void | Promise<void>;
  }): Promise<string> {
    const result = await this.runCommand(input, "ADE version", { executable: this.executable, args: ["--version"] });
    const detected = parseVersion(`${result.stdout}\n${result.stderr}`);
    const expected = parseVersion(this.expectedVersion);
    if (detected && expected && detected !== expected) {
      throw new AdeDeliveryError("ADE_RUNTIME_MISMATCH", `The worker ADE runtime is ${detected}, but the task requires ${expected}.`);
    }
    return detected ?? expected ?? this.expectedVersion;
  }

  private requireReadySetup(evaluation: AdeSetupEvaluation): void {
    if (evaluation.readiness === "invalid") {
      throw new AdeDeliveryError("ADE_SETUP_INVALID", "ADE project setup is invalid; fix the repository configuration before mutating work.");
    }
    if (evaluation.readiness === "incomplete") {
      const missing = evaluation.missingRequiredIds.filter(isSafeSetupId).slice(0, 8);
      throw new AdeDeliveryError(
        "ADE_SETUP_INCOMPLETE",
        `ADE project setup is incomplete${missing.length > 0 ? `: ${missing.join(", ")}` : "."}`,
      );
    }
  }

  private async runAde(
    input: { cwd: string; work: AdeDeliveryWorkContext; signal?: AbortSignal; onOutput?(output: CommandOutput): void | Promise<void> },
    args: readonly string[],
    label: string,
    failureCode: "ADE_CONFIG_INVALID" | "ADE_CONTEXT_FAILED" | "ADE_DETERMINISTIC_REVIEW_FAILED",
  ): Promise<CommandResult> {
    try {
      return await this.runCommand(input, label, { executable: this.executable, args });
    } catch (error) {
      if (failureCode === "ADE_CONFIG_INVALID" && error instanceof AdeDeliveryError && /CONFIG_NOT_FOUND|config(?:uration)? .*missing|no .*config/iu.test(error.message)) {
        throw new AdeDeliveryError("ADE_CONFIG_MISSING", "ADE project configuration is missing; complete project setup before mutating work.");
      }
      throw new AdeDeliveryError(failureCode, error instanceof AdeDeliveryError ? error.safeSummary : `${label} failed.`);
    }
  }

  private async runCommand(
    input: { cwd: string; work: AdeDeliveryWorkContext; signal?: AbortSignal; onOutput?(output: CommandOutput): void | Promise<void> },
    label: string,
    command: { executable: string; args: readonly string[] },
  ): Promise<CommandResult> {
    const result = await this.options.commands.run({
      executable: command.executable,
      args: command.args,
      cwd: input.cwd,
      ...(this.options.environment ? { env: this.options.environment } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onOutput ? { onOutput: input.onOutput } : {}),
    });
    if (result.exitCode !== 0) {
      const detail = `${result.stdout}\n${result.stderr}`.slice(0, 500);
      throw new AdeDeliveryError("ADE_CONFIG_INVALID", `${label} failed${detail.trim() ? `: ${sanitizeDetail(detail)}` : "."}`);
    }
    return result;
  }

  private async runProfileReviews(
    input: {
      cwd: string;
      work: AdeDeliveryWorkContext;
      agentExecutor: AgentExecutor;
      signal?: AbortSignal;
      onOutput?(output: CommandOutput): void | Promise<void>;
    },
    profiles: readonly string[],
    attempt: number,
    findings: AdeProfileFinding[],
    usage: AgentUsageMetrics[],
    instructionsByProfile: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    let pass = true;
    for (const profile of profiles) {
      const result = await input.agentExecutor.execute({
        cwd: input.cwd,
        prompt: instructionsByProfile.get(profile) ?? "",
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onOutput ? { onOutput: input.onOutput } : {}),
      });
      if (result.usage) usage.push(result.usage);
      if (result.exitCode !== 0) {
        throw new AdeDeliveryError("ADE_PROFILE_REVIEW_FAILED", `ADE profile review ${profile} failed.`);
      }
      const parsed = parseProfileReview(result.stdout, profile, attempt);
      findings.push(...parsed);
      if (parsed.some((finding) => finding.blocking && finding.status === "open")) pass = false;
    }
    return pass;
  }
}

function configuredRulePacks(project: ProjectRecord): readonly string[] {
  const ade = asRecord(project.configuration.ade);
  return boundedStrings(ade.rulePacks ?? ade.rules, 20);
}

function configuredContextProfile(project: ProjectRecord): string | null {
  const ade = asRecord(project.configuration.ade);
  const profile = ade.contextProfile;
  return typeof profile === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(profile) ? profile : null;
}

function parseProfileReview(stdout: string, profile: string, attempt: number): readonly AdeProfileFinding[] {
  const object = [...stdout.split(/\r?\n/u)].toReversed().map(parseJson).find((value): value is Record<string, unknown> => isRecord(value) && Array.isArray(value.findings));
  if (!object || !Array.isArray(object.findings)) return [];
  return object.findings.slice(0, 20).flatMap((raw): AdeProfileFinding[] => {
    if (!isRecord(raw)) return [];
    const summary = typeof raw.summary === "string" ? boundedText(raw.summary, 500) : "Profile reviewer returned a finding.";
    const status = raw.status === "accepted-risk" || raw.status === "not-applicable" || raw.status === "fixed" ? raw.status : "open";
    const severity = raw.severity === "info" || raw.severity === "warning" ? raw.severity : "error";
    return [{ profile, severity, category: typeof raw.category === "string" ? boundedText(raw.category, 100) : "general", summary, blocking: raw.blocking === true, status, attempt }];
  });
}

function parseVersion(value: string): string | null {
  const match = value.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u);
  return match?.[1] ?? null;
}

function boundedStrings(value: unknown, limit: number): readonly string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && /^[a-z0-9][a-z0-9._/-]{0,99}$/iu.test(entry)).slice(0, limit))] : [];
}

function asRecord(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

interface SetupEvaluationSummary {
  version: string;
  adeVersion: string;
  readiness: "ready" | "incomplete" | "invalid";
  missingRequiredIds: readonly string[];
  diagnostics: AdeSetupEvaluation["diagnostics"];
  configurationErrors: readonly string[];
  missingExecutionCapabilityIds: readonly string[];
}

function parseSetupEvaluation(stdout: string): SetupEvaluationSummary | null {
  const value = parseJson(stdout.trim());
  if (!isRecord(value)) return null;
  const version = typeof value.version === "string" ? value.version : null;
  const adeVersion = typeof value.adeVersion === "string" ? parseVersion(value.adeVersion) : null;
  const readiness = value.readiness === "ready" || value.readiness === "incomplete" || value.readiness === "invalid" ? value.readiness : null;
  const missingRequiredIds = Array.isArray(value.missingRequiredIds)
    ? value.missingRequiredIds.filter((entry): entry is string => typeof entry === "string")
    : null;
  if (!version || !adeVersion || !readiness || !missingRequiredIds) return null;
  const safeText = (text: unknown) => typeof text === "string" ? redactDiagnostic(text, 600) : "";
  const diagnostics = (Array.isArray(value.requirements) ? value.requirements : []).slice(0, 100).flatMap((entry) =>
    isRecord(entry) && typeof entry.id === "string" && isSafeSetupId(entry.id) && ["satisfied", "unsatisfied", "unverifiable"].includes(String(entry.status))
      ? [{ id: entry.id, status: String(entry.status), criticality: ["required", "recommended", "optional"].includes(String(entry.criticality)) ? String(entry.criticality) : "unspecified", detail: safeText(entry.detail), remediation: safeText(entry.remediation) }] : []);
  for (const entry of (Array.isArray(value.executionCapabilities) ? value.executionCapabilities : []).slice(0, 20)) {
    if (isRecord(entry) && typeof entry.id === "string" && isSafeSetupId(entry.id) && ["available", "missing"].includes(String(entry.status))) {
      diagnostics.push({ id: entry.id, status: String(entry.status), criticality: "capability", detail: safeText(entry.detail), remediation: "" });
    }
  }
  const configurationErrors = (Array.isArray(value.configurationErrors) ? value.configurationErrors : []).slice(0, 20).map(safeText).filter(Boolean);
  return { version, adeVersion, readiness, missingRequiredIds, diagnostics, configurationErrors,
    missingExecutionCapabilityIds: boundedStrings(value.missingExecutionCapabilityIds, 20) };
}

// Version declarations are diagnostic context, not a replacement for ADE's
// compatibility verdict. A lower range floor does not prove an installed version.
async function readDeclaredAdeDependency(cwd: string): Promise<string | null> {
  try {
    const path = join(cwd, "package.json");
    if ((await stat(path)).size > 1_000_000) return null;
    const manifest = asRecord(parseJson(await readFile(path, "utf8")));
    const value = asRecord(manifest.dependencies)["@alelouet/ai-delivery-engine"] ?? asRecord(manifest.devDependencies)["@alelouet/ai-delivery-engine"];
    return typeof value === "string" && value.length <= 64 && /^[~^]?\d+\.\d+\.\d+$/u.test(value) ? value : null;
  } catch { return null; }
}

function isOlderDeclaration(declaration: string, runtime: string): boolean {
  const declared = declaration.replace(/^[~^]/u, "").split(".").map(Number);
  const current = runtime.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (declared[i]! !== current[i]!) return declared[i]! < current[i]!;
  }
  return false;
}

function parseDeliveryPlan(stdout: string): AdeDeliveryPlan | null {
  const value = parseJson(stdout.trim());
  if (!isRecord(value) || value.version !== ADE_DELIVERY_PLAN_VERSION || value.status !== "supported" || !isRecord(value.plan)) return null;
  const plan = value.plan;
  const lifecycle = isRecord(plan.lifecycle) ? plan.lifecycle : null;
  const implementation = isRecord(plan.implementation) ? plan.implementation : null;
  const correction = isRecord(plan.correction) ? plan.correction : null;
  const publication = isRecord(plan.publication) ? plan.publication : null;
  const reviews = Array.isArray(plan.reviews) ? plan.reviews : null;
  const validations = Array.isArray(plan.validations) ? plan.validations : null;
  if (!lifecycle || !implementation || !correction || !publication || !reviews || !validations ||
      (lifecycle.action !== "enrich" && lifecycle.action !== "develop" && lifecycle.action !== "wait" && lifecycle.action !== "none") ||
      typeof lifecycle.reason !== "string" || typeof implementation.profile !== "string" ||
      typeof correction.maximumAttempts !== "number" || !Number.isInteger(correction.maximumAttempts) || correction.maximumAttempts < 0 || correction.maximumAttempts > 5 ||
      typeof publication.ready !== "boolean") return null;
  const safe = (entry: unknown, key: string, max: number): string | null => isRecord(entry) && typeof entry[key] === "string" && new RegExp(`^[a-z0-9][a-z0-9._/-]{0,${max}}$`, "iu").test(entry[key]) ? entry[key] as string : null;
  const reviewProfiles = reviews.map((review) => safe(review, "profile", 99));
  const validationRuleIds = validations.map((validation) => safe(validation, "ruleId", 127));
  const selectionReasons = reviews.map((review) => isRecord(review) && typeof review.reason === "string" ? boundedText(review.reason, 500) : null);
  const instructions = reviews.map((review) => isRecord(review) && isRecord(review.invocation) && review.invocation.version === "ade.profile-invocation/v1" && review.invocation.kind === "specialist-review" && typeof review.invocation.instructions === "string" ? boundedText(review.invocation.instructions, 4_000) : null);
  const correctionInstructions = isRecord(correction.invocation) && correction.invocation.version === "ade.profile-invocation/v1" && correction.invocation.kind === "correction" && typeof correction.invocation.instructions === "string" ? boundedText(correction.invocation.instructions, 4_000) : null;
  if (reviewProfiles.some((profile) => profile === null) || selectionReasons.some((reason) => !reason) || instructions.some((instruction) => !instruction) || validationRuleIds.some((rule) => rule === null) || !safe(implementation, "profile", 99) || (reviews.length > 0 && !correctionInstructions)) return null;
  return { version: ADE_DELIVERY_PLAN_VERSION, action: lifecycle.action, reason: boundedText(lifecycle.reason, 500), implementationProfile: implementation.profile, reviews: (reviewProfiles as string[]).map((profile, index) => ({ profile, selectionReason: selectionReasons[index]!, instructions: instructions[index]! })), validationRuleIds: [...new Set(validationRuleIds as string[])], maximumCorrectionAttempts: correction.maximumAttempts, correctionInstructions, publicationReady: publication.ready };
}

function deliveryPlanCompatibilityReason(stdout: string): string | null {
  const value = parseJson(stdout.trim());
  if (!isRecord(value) || value.status !== "unsupported" || !isRecord(value.reason) || typeof value.reason.code !== "string" || typeof value.reason.message !== "string") return null;
  return `ADE delivery-plan incompatibility (${boundedText(value.reason.code, 80)}): ${boundedText(value.reason.message, 500)}`;
}

function isSafeSetupId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,99}$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: string, maximum: number): string { return value.replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, maximum); }
function sanitizeDetail(value: string): string { return boundedText(value, 500).replace(/(?:token|secret|password|key)\s*[:=]\s*\S+/giu, "$1=[redacted]"); }
