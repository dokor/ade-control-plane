import type { AgentUsageMetrics, JsonObject, ProjectRecord } from "@ade-control-plane/database";

import type { CommandOutput, CommandResult, CommandRunner } from "./v0/CommandRunner.js";
import type { AgentExecutor } from "./AgentExecutor.js";

export type AdeDeliveryFailureCode =
  | "ADE_RUNTIME_MISMATCH"
  | "ADE_CONFIG_MISSING"
  | "ADE_CONFIG_INVALID"
  | "ADE_CONTEXT_FAILED"
  | "ADE_SETUP_INCOMPLETE"
  | "ADE_SETUP_INVALID"
  | "ADE_DELIVERY_PLAN_UNSUPPORTED"
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
  reviewProfiles: readonly string[];
  validationRuleIds: readonly string[];
  maximumCorrectionAttempts: number;
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
  maxReviewAttempts?: number;
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
  private readonly maxReviewAttempts: number;

  public constructor(private readonly options: AdeDeliveryRuntimeOptions) {
    this.executable = options.executable ?? "ade";
    this.expectedVersion = options.expectedVersion ?? "unknown";
    this.maxReviewAttempts = clampAttempts(options.maxReviewAttempts ?? 2);
  }

  public async prepare(input: {
    cwd: string;
    work: AdeDeliveryWorkContext;
    contextProfile?: string;
    signal?: AbortSignal;
    onOutput?(output: CommandOutput): void | Promise<void>;
  }): Promise<AdeDeliveryPreparation> {
    const runtimeVersion = await this.detectVersion(input);
    await this.runAde(input, ["config", "validate"], "ADE config validation", "ADE_CONFIG_INVALID");
    const contextProfile = input.contextProfile ?? configuredContextProfile(input.work.project) ?? "normal";
    await this.runAde(input, ["context", "generate"], "ADE project context generation", "ADE_CONTEXT_FAILED");
    await this.runAde(input, ["context", "pack", contextProfile], `ADE ${contextProfile} context pack`, "ADE_CONTEXT_FAILED");
    const setupContractVersion = await this.runSetupCheck(input, runtimeVersion);
    return {
      runtimeVersion,
      setupContractVersion,
      contextProfile,
      rulePackIds: configuredRulePacks(input.work.project),
    };
  }

  /** Negotiates ADE's repository-owned delivery contract over stdin. */
  public async resolveDeliveryPlan(input: { cwd: string; issue: { number: number; title: string; body: string; labels: readonly string[]; state: "open" | "closed"; url: string }; signal?: AbortSignal }): Promise<AdeDeliveryPlan> {
    let result: CommandResult;
    try {
      result = await this.options.commands.run({
        executable: this.executable, args: ["delivery", "plan", "--json"], cwd: input.cwd,
        stdin: JSON.stringify({ issue: input.issue, negotiation: { acceptedVersions: [ADE_DELIVERY_PLAN_VERSION], requiredCapabilities: ["implementation-context", "deterministic-validation", "specialist-review", "correction-and-rereview", "human-publication-gate"] } }),
        ...(this.options.environment ? { env: this.options.environment } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch {
      throw new AdeDeliveryError("ADE_DELIVERY_PLAN_UNSUPPORTED", "The installed ADE runtime could not negotiate the required delivery-plan contract.");
    }
    const plan = parseDeliveryPlan(result.stdout);
    if (result.exitCode !== 0 || !plan) throw new AdeDeliveryError("ADE_DELIVERY_PLAN_UNSUPPORTED", "The installed ADE runtime does not provide the required delivery-plan contract.");
    return plan;
  }

  public async runPostAgentGates(input: {
    cwd: string;
    work: AdeDeliveryWorkContext;
    agentExecutor: AgentExecutor;
    prepared: AdeDeliveryPreparation;
    plan?: AdeDeliveryPlan;
    signal?: AbortSignal;
    onOutput?(output: CommandOutput): void | Promise<void>;
  }): Promise<AdeDeliveryReviewResult> {
    let selectedProfiles: readonly string[] | undefined;
    const findings: AdeProfileFinding[] = [];
    const usage: AgentUsageMetrics[] = [];
    let attempt = 0;

    // Zero means no correction retry, never "skip the first validation pass".
    const maximumAttempts = Math.max(1, input.plan?.maximumCorrectionAttempts ?? this.maxReviewAttempts);
    while (attempt < maximumAttempts) {
      attempt += 1;
      await this.runCommand(input, "git add", {
        executable: "git",
        args: ["-c", "core.hooksPath=/dev/null", "add", "--all"],
      });
      if (!selectedProfiles) {
        const changedPaths = await this.listChangedPaths(input);
        selectedProfiles = input.plan?.reviewProfiles ?? selectProfiles({ ...input.work, affectedPaths: changedPaths });
      }
      await this.runAde(input, ["review", "--staged", "--json"], "ADE deterministic staged review", "ADE_DETERMINISTIC_REVIEW_FAILED");

      const pass = await this.runProfileReviews(input, selectedProfiles, attempt, findings, usage);
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
        prompt: buildCorrectionPrompt(input.work, findings.filter((finding) => finding.blocking)),
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

  private async listChangedPaths(input: { cwd: string; work: AdeDeliveryWorkContext }): Promise<readonly string[]> {
    const result = await this.options.commands.run({
      executable: "git",
      args: ["-c", "core.hooksPath=/dev/null", "diff", "--cached", "--name-only", "--"],
      cwd: input.cwd,
      ...(this.options.environment ? { env: this.options.environment } : {}),
    });
    if (result.exitCode !== 0) return input.work.affectedPaths ?? [];
    return result.stdout.split(/\r?\n/u).map((path) => path.trim()).filter((path) => path.length > 0).slice(0, 100);
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

  private async runSetupCheck(
    input: { cwd: string; work: AdeDeliveryWorkContext; signal?: AbortSignal },
    runtimeVersion: string,
  ): Promise<string> {
    let result: CommandResult;
    try {
      // ADE owns the setup catalogue and evaluation. Keep its JSON response
      // private to this boundary: it may contain configuration diagnostics,
      // while the worker only needs the safe readiness verdict and IDs.
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
    if (result.exitCode !== 0) {
      throw new AdeDeliveryError("ADE_SETUP_INVALID", "ADE project setup returned an inconsistent readiness result.");
    }
    return evaluation.version;
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
  ): Promise<boolean> {
    let pass = true;
    for (const profile of profiles) {
      const result = await input.agentExecutor.execute({
        cwd: input.cwd,
        prompt: buildProfileReviewPrompt(input.work, profile),
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

export function selectProfiles(work: AdeDeliveryWorkContext): readonly string[] {
  const configured = configuredProfiles(work.project);
  if (configured.length > 0) return configured;
  const text = `${work.prompt} ${work.issueTitle ?? ""} ${(work.affectedPaths ?? []).join(" ")}`.toLowerCase();
  const profiles: string[] = [];
  if (/doc|documentation|readme|copy/iu.test(text)) profiles.push("documentation");
  if (/front|ui|ux|css|tsx|react|component/iu.test(text)) profiles.push("frontend");
  if (/seo|metadata|sitemap/iu.test(text)) profiles.push("seo");
  if (/api|backend|server|database|sql|worker/iu.test(text)) profiles.push("backend");
  if (/auth|security|permission|secret|token|credential/iu.test(text)) profiles.push("security");
  if (profiles.includes("security") && !profiles.includes("backend")) profiles.unshift("backend");
  if (!profiles.includes("documentation") && !profiles.includes("frontend") && !profiles.includes("backend")) profiles.push("tech-lead");
  if (!profiles.includes("documentation")) profiles.push("qa");
  return [...new Set(profiles), ...(profiles.includes("tech-lead") ? [] : ["tech-lead"])];
}

function configuredProfiles(project: ProjectRecord): readonly string[] {
  const ade = asRecord(project.configuration.ade);
  const raw = ade.profileReviews ?? ade.profiles ?? ade.requiredProfiles;
  return boundedStrings(raw, 12);
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

function buildProfileReviewPrompt(work: AdeDeliveryWorkContext, profile: string): string {
  return [
    `Act as the ADE ${profile} specialist reviewer for the selected repository.`,
    "Review the current staged diff and the authoritative work reference below.",
    "Do not edit files, commit, push, create a pull request, or use GitHub publication actions.",
    "Return one JSON object on one line with this shape:",
    '{"status":"pass|findings","findings":[{"severity":"info|warning|error","category":"short-code","summary":"safe summary","blocking":true|false,"status":"open|accepted-risk|not-applicable"}]}',
    "Never include chain-of-thought, secrets, raw prompts, or full file contents.",
    `Work: ${work.issueNumber ? `GitHub issue #${work.issueNumber}` : "manual task"}`,
    `Summary: ${boundedText(work.issueTitle ?? work.prompt, 1_000)}`,
    `Profile: ${profile}`,
  ].join("\n");
}

function buildCorrectionPrompt(work: AdeDeliveryWorkContext, findings: readonly AdeProfileFinding[]): string {
  return [
    "Apply only the smallest code/documentation corrections required by the blocking ADE profile findings below.",
    "Follow the authoritative task, repository instructions and existing project policy.",
    "Do not commit, push, create a pull request, or expose credentials.",
    `Task: ${boundedText(work.issueTitle ?? work.prompt, 1_000)}`,
    "Blocking findings:",
    ...findings.map((finding) => `- [${finding.profile}] ${finding.category}: ${finding.summary}`),
  ].join("\n");
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
  return { version, adeVersion, readiness, missingRequiredIds };
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
  if (reviewProfiles.some((profile) => profile === null) || validationRuleIds.some((rule) => rule === null) || !safe(implementation, "profile", 99)) return null;
  return { version: ADE_DELIVERY_PLAN_VERSION, action: lifecycle.action, reason: boundedText(lifecycle.reason, 500), implementationProfile: implementation.profile, reviewProfiles: [...new Set(reviewProfiles as string[])], validationRuleIds: [...new Set(validationRuleIds as string[])], maximumCorrectionAttempts: correction.maximumAttempts, publicationReady: publication.ready };
}

function isSafeSetupId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,99}$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: string, maximum: number): string { return value.replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, maximum); }
function sanitizeDetail(value: string): string { return boundedText(value, 500).replace(/(?:token|secret|password|key)\s*[:=]\s*\S+/giu, "$1=[redacted]"); }
function clampAttempts(value: number): number { return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 2; }
