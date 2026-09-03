import { randomUUID } from "node:crypto";

import {
  evaluateSchedule,
  selectGithubWork,
  type GithubWorkSelection,
  type SchedulerCandidate,
  type SchedulerRunner,
} from "@ade-control-plane/core";
import type {
  ControlPlanePersistence,
  ExecutionRecord,
  GithubWorkItemRecord,
  GithubWorkProfileRecord,
  ProjectRecord,
  RunnerRecord,
} from "@ade-control-plane/database";
import { GithubWorkAdapterError, type GithubWorkItem, type GithubWorkReader, type GithubWorkRepositoryProfile } from "@ade-control-plane/github";
import type { AgentProvider } from "./AgentExecutor.js";
import type { AgentUsageInput } from "@ade-control-plane/database";

export interface GithubWorkDispatchRequest {
  executionId: string;
  project: ProjectRecord;
  work: GithubWorkItemRecord;
  skillPaths: readonly string[];
  signal?: AbortSignal;
  /** A resolved ADE decision is a continuation of the existing workflow. */
  resumeDecision?: {
    decisionRef: string;
    option: string;
    resolvedBy: string;
  };
  /** Internal stage notification used to renew the bounded stage deadline. */
  onStage?(stage: string): void;
}

export interface GithubWorkDispatchResult {
  status: "succeeded" | "failed" | "cancelled";
  resultSummary?: Record<string, string | number>;
  errorCode?: string;
  errorSummary?: string;
  provider?: string;
  usage?: import("@ade-control-plane/database").AgentUsageMetrics;
}

/** A narrow port: all shell/Codex access remains behind a typed dispatch request. */
export interface GithubWorkDispatcher {
  execute(request: GithubWorkDispatchRequest): Promise<GithubWorkDispatchResult>;
}

/** Proactive GitHub attention is best-effort and never changes scheduling. */
export interface GithubWorkAttentionNotifier {
  waitingHuman(project: ProjectRecord, work: GithubWorkItemRecord): Promise<void>;
  failure(project: ProjectRecord, work: GithubWorkItemRecord, errorCode: string): Promise<void>;
}

export interface GithubWorkOrchestratorOptions {
  persistence: ControlPlanePersistence;
  reader: GithubWorkReader;
  dispatcher: GithubWorkDispatcher;
  notifier?: GithubWorkAttentionNotifier;
  ownerId: string;
  /** Matches V0 behaviour when no App Server quota source is configured. */
  allowStartWithoutQuotaSnapshot?: boolean;
  provider?: AgentProvider;
  agentUsage?: Pick<import("@ade-control-plane/database").AgentUsageRepository, "record">;
  leaseDurationMs?: number;
  cancelPollMs?: number;
  heartbeatIntervalMs?: number;
  stageTimeoutMs?: number;
  workflowTimeoutMs?: number;
  reconciliationBackoffBaseMs?: number;
  reconciliationBackoffMaxMs?: number;
  now?(): Date;
}

export type GithubWorkCycleResult =
  | { outcome: "dispatched"; projectId: string; issueNumber: number; executionId: string }
  | { outcome: "idle"; reason: string; nextWakeUpAt?: string };

/**
 * GitHub-first continuous cycle. A cycle reconciles the strict contract before
 * it schedules, then creates the execution and lease in one DB transaction.
 * Duplicate/missed webhooks cannot launch code directly and a crashed active
 * lease remains a visible blocker rather than being silently retried.
 */
export class GithubWorkOrchestrator {
  private readonly now: () => Date;
  private readonly leaseDurationMs: number;
  private readonly cancelPollMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly stageTimeoutMs: number;
  private readonly workflowTimeoutMs: number;
  private readonly reconciliationBackoffBaseMs: number;
  private readonly reconciliationBackoffMaxMs: number;
  private readonly reconciliationBackoff = new Map<string, { failures: number; retryAt: string }>();

  public constructor(private readonly options: GithubWorkOrchestratorOptions) {
    this.now = options.now ?? (() => new Date());
    this.leaseDurationMs = options.leaseDurationMs ?? 15 * 60 * 1_000;
    this.cancelPollMs = positiveDuration(options.cancelPollMs, 1_000);
    this.heartbeatIntervalMs = positiveDuration(options.heartbeatIntervalMs, Math.max(1_000, Math.floor(this.leaseDurationMs / 3)));
    this.stageTimeoutMs = positiveDuration(options.stageTimeoutMs, 15 * 60 * 1_000);
    this.workflowTimeoutMs = positiveDuration(options.workflowTimeoutMs, 60 * 60 * 1_000);
    this.reconciliationBackoffBaseMs = positiveDuration(options.reconciliationBackoffBaseMs, 30_000);
    this.reconciliationBackoffMaxMs = Math.max(this.reconciliationBackoffBaseMs, positiveDuration(options.reconciliationBackoffMaxMs, 15 * 60 * 1_000));
  }

  public async reconcileAll(): Promise<void> {
    const projects = await this.options.persistence.projects.list();
    for (const project of projects) await this.reconcileProject(project);
  }

  /**
   * Converts active GitHub-work ownership left by a crashed process into an
   * explicit reconciliation candidate before new work can be scheduled.
   * Unknown outcomes are never retried automatically.
   */
  public async reconcileExecutions(): Promise<void> {
    const candidates = await this.options.persistence.executions.listReconciliationCandidates(this.now().toISOString());
    for (const candidate of candidates) {
      if (!candidate.execution.workRef?.startsWith("github:issue:")) continue;
      await this.options.persistence.executions.complete({
        executionId: candidate.execution.id,
        status: "unknown",
        finishedAt: this.now().toISOString(),
        errorCode: "GITHUB_WORK_RECONCILIATION_REQUIRED",
        errorSummary: "The previous worker stopped before GitHub work completion was confirmed.",
        releaseReason: "github-work-startup-reconciliation",
        auditEvent: {
          occurredAt: this.now().toISOString(), category: "execution", severity: "warning", actorType: "system",
          projectId: candidate.execution.projectId, executionId: candidate.execution.id, runnerId: candidate.execution.runnerId,
          action: "github-work.startup-reconciliation", result: "unknown", metadata: { recoveryReason: candidate.reason },
        },
      });
    }
  }

  public async runCycle(input: { reconcile?: "full" | "targeted" | "none"; projectId?: string } = {}): Promise<GithubWorkCycleResult> {
    if (input.reconcile === "targeted" && input.projectId) {
      const project = await this.options.persistence.projects.getById(input.projectId);
      if (project) await this.reconcileProject(project);
    } else if (input.reconcile !== "none") {
      await this.reconcileAll();
    }
    const now = this.now().toISOString();
    const store = this.options.persistence;
    const [settings, projects, runners, active] = await Promise.all([
      store.settings.get(), store.projects.list(), store.runners.list(), store.executions.listActive(),
    ]);
    const [items, profiles, histories, quota] = await Promise.all([
      store.githubWork.listForProjects(projects.map(({ id }) => id)),
      Promise.all(projects.map((project) => store.githubWork.getProfile(project.id))),
      Promise.all(projects.map((project) => store.executions.listByProjectId(project.id, 100))),
      store.providerQuotaSnapshots.getLatest("openai", "codex-account-main"),
    ]);
    const itemsByProject = groupByProject(items);
    const profilesByProject = new Map(
      profiles.filter((profile): profile is GithubWorkProfileRecord => profile !== null)
        .map((profile) => [profile.projectId, profile]),
    );
    const activeByProject = new Set(active.map(({ projectId }) => projectId));
    const historyByProject = new Map(projects.map((project, index) => [project.id, histories[index] ?? []]));
    const resolvedDecisions = new Map<string, { decisionRef: string; option: string; resolvedBy: string }>();
    for (const project of projects) {
      const item = (itemsByProject.get(project.id) ?? []).find((candidate) => candidate.present && candidate.state === "waiting-human" && candidate.humanDecisionRef);
      if (!item?.humanDecisionRef) continue;
      const decision = await store.adeDecisions.getByRef(project.id, item.humanDecisionRef);
      const history = historyByProject.get(project.id) ?? [];
      const alreadyResumed = history.some((execution) =>
        ["succeeded", "failed", "cancelled", "unknown"].includes(execution.status) &&
        execution.resultSummary?.resumeDecisionRef === decision?.decisionRef,
      );
      if (!alreadyResumed && decision?.status === "resolved" && decision.resolvedOption && decision.resolvedBy) {
        resolvedDecisions.set(project.id, { decisionRef: decision.decisionRef, option: decision.resolvedOption, resolvedBy: decision.resolvedBy });
      }
    }
    const selections = new Map(projects.map((project) => {
      const selection = selectProjectWork(profilesByProject.get(project.id) ?? null, itemsByProject.get(project.id) ?? [], now);
      const resume = resolvedDecisions.get(project.id);
      return [project.id, resume && selection.item
        ? { availability: "ready" as const, item: selection.item, reason: "An ADE human decision was resolved; the workflow can resume." }
        : selection];
    }));
    const decision = evaluateSchedule({
      mode: settings.schedulerMode,
      now,
      quota: { state: quota?.policyState ?? (this.options.allowStartWithoutQuotaSnapshot ? "normal" : "unknown"), ...(quota?.resetsAt ? { resetsAt: quota.resetsAt } : {}) },
      candidates: projects.map((project) => toCandidate(
        project,
        selections.get(project.id)!,
        activeByProject.has(project.id),
        historyByProject.get(project.id) ?? [],
        resolvedDecisions.has(project.id),
      )),
      runners: runners.map(toRunner),
    });
    if (!decision.selected) {
      const nextWakeUpAt = earliestWakeUpAt(decision.nextWakeUpAt, this.nextReconciliationWakeUpAt(now));
      return { outcome: "idle", reason: decision.reason, ...(nextWakeUpAt ? { nextWakeUpAt } : {}) };
    }

    const project = projects.find((entry) => entry.id === decision.selected?.projectId);
    const selection = project ? selections.get(project.id) : undefined;
    const profile = project ? profilesByProject.get(project.id) : undefined;
    const work = project && selection?.item
      ? itemsByProject.get(project.id)?.find((item) => item.issueNumber === selection.item?.issueNumber)
      : undefined;
    if (!project || !selection?.item || !profile || !work) {
      throw new Error("Scheduler selected a GitHub work item that disappeared from the durable projection.");
    }
    const executionId = randomUUID();
    const scheduled = await store.executions.scheduleWithLease({
      execution: {
        id: executionId,
        projectId: project.id,
        runnerId: decision.selected.runnerId,
        workRef: githubWorkRef(selection.item.issueNumber),
        capability: `github-work.${this.options.provider ?? "codex"}`,
        requestedAt: now,
      },
      lease: {
        projectId: project.id,
        runnerId: decision.selected.runnerId,
        ownerId: this.options.ownerId,
        leaseKey: `github-work:${project.id}:${selection.item.issueNumber}`,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: new Date(this.now().getTime() + this.leaseDurationMs).toISOString(),
      },
    });
    if (!scheduled) return { outcome: "idle", reason: "Another worker already owns the GitHub work lease." };

    await store.executions.markDispatched(scheduled.execution.id, now);
    await store.executions.markRunning(scheduled.execution.id, now);
    try {
      const resumeDecision = resolvedDecisions.get(project.id);
      const result = await this.dispatchWithCancellation({
        executionId: scheduled.execution.id,
        project,
        work,
        skillPaths: profile.skillPaths,
        ...(resumeDecision ? { resumeDecision } : {}),
      });
      await store.executions.complete({
        executionId: scheduled.execution.id,
        status: result.status,
        finishedAt: this.now().toISOString(),
        resultSummary: {
          ...(result.resultSummary ?? {}),
          sourceUpdatedAt: selection.item.sourceUpdatedAt,
          issueNumber: selection.item.issueNumber,
          ...(resumeDecision ? { resumeDecisionRef: resumeDecision.decisionRef } : {}),
        },
        errorCode: result.errorCode ?? null,
        errorSummary: result.errorSummary ?? null,
        releaseReason: `github-work-${result.status}`,
        auditEvent: {
          occurredAt: this.now().toISOString(), category: "execution",
          severity: result.status === "succeeded" ? "info" : "warning", actorType: "system",
          projectId: project.id, runnerId: decision.selected.runnerId,
          action: "github-work.completed", result: result.status,
          metadata: { issueNumber: selection.item.issueNumber },
        },
      });
      await this.recordUsage(scheduled.execution.startedAt ?? now, this.now().toISOString(), project.id, work, result, scheduled.execution.id);
      if (result.status === "failed") {
        await this.options.notifier?.failure(project, work, result.errorCode ?? "EXECUTION_FAILED");
      }
    } catch (error) {
      const cancelled = error instanceof GithubExecutionCancelledError;
      const timedOut = error instanceof GithubExecutionTimeoutError;
      const leaseLost = error instanceof GithubLeaseLostError;
      const unknown = timedOut || leaseLost;
      const timeoutCode = timedOut && error.kind === "stage" ? "GITHUB_STAGE_TIMEOUT" : "GITHUB_WORK_TIMEOUT";
      await store.executions.complete({
        executionId: scheduled.execution.id, status: unknown ? "unknown" : cancelled ? "cancelled" : "failed", finishedAt: this.now().toISOString(),
        errorCode: unknown ? (timedOut ? timeoutCode : "GITHUB_LEASE_LOST") : cancelled ? null : "AGENT_DISPATCH_FAILED",
        errorSummary: unknown ? (timedOut ? "The GitHub-work deadline elapsed before completion was confirmed." : "The execution lease could not be renewed; reconcile before retrying.") : cancelled ? null : "The code-agent dispatch failed.",
        releaseReason: unknown ? (timedOut ? "github-work-timeout" : "github-work-lease-lost") : cancelled ? "github-work-cancelled" : "github-work-dispatch-failed",
        auditEvent: {
          occurredAt: this.now().toISOString(), category: "execution", severity: cancelled ? "info" : "warning", actorType: "system",
          projectId: project.id, runnerId: decision.selected.runnerId,
          action: unknown ? "github-work.reconciliation-required" : cancelled ? "github-work.cancelled" : "github-work.dispatch-failed",
          result: unknown ? "unknown" : cancelled ? "cancelled" : "failed", metadata: { issueNumber: selection.item.issueNumber },
        },
      });
      if (cancelled || unknown) return { outcome: "dispatched", projectId: project.id, issueNumber: selection.item.issueNumber, executionId };
      await this.options.agentUsage?.record({
        executionId: scheduled.execution.id,
        projectId: project.id,
        githubIssueNumber: work.issueNumber,
        provider: this.options.provider ?? "codex",
        startedAt: scheduled.execution.startedAt ?? now,
        finishedAt: this.now().toISOString(),
        costKind: "unknown",
        usageSource: "unknown",
        observedAt: this.now().toISOString(),
      }).catch(() => undefined);
      await this.options.notifier?.failure(project, work, "AGENT_DISPATCH_FAILED");
    }
    return { outcome: "dispatched", projectId: project.id, issueNumber: selection.item.issueNumber, executionId };
  }

  private async dispatchWithCancellation(request: GithubWorkDispatchRequest): Promise<GithubWorkDispatchResult> {
    const controller = new AbortController();
    let checking = false;
    let timedOut: "stage" | "workflow" | false = false;
    let leaseLost = false;
    const checkCancellation = async (): Promise<void> => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        if ((await this.options.persistence.executions.getById(request.executionId))?.cancelRequested) controller.abort();
      } finally {
        checking = false;
      }
    };
    await checkCancellation();
    const renewLease = async (): Promise<void> => {
      if (controller.signal.aborted) return;
      try {
        const heartbeatAt = this.now().toISOString();
        await this.options.persistence.executionLeases.heartbeat(
          request.executionId,
          this.options.ownerId,
          heartbeatAt,
          new Date(this.now().getTime() + this.leaseDurationMs).toISOString(),
        );
      } catch {
        leaseLost = true;
        controller.abort();
      }
    };
    const workflowTimeout = setTimeout(() => {
      timedOut = "workflow";
      controller.abort();
    }, this.workflowTimeoutMs);
    let stageTimeout: NodeJS.Timeout | undefined;
    const armStageTimeout = (): void => {
      if (stageTimeout) clearTimeout(stageTimeout);
      stageTimeout = setTimeout(() => {
        timedOut = "stage";
        controller.abort();
      }, this.stageTimeoutMs);
    };
    armStageTimeout();
    const heartbeat = setInterval(() => { void renewLease(); }, this.heartbeatIntervalMs);
    const interval = setInterval(() => { void checkCancellation(); }, this.cancelPollMs);
    try {
      const result = await this.options.dispatcher.execute({
        ...request,
        signal: controller.signal,
        onStage: () => armStageTimeout(),
      });
      if (timedOut) throw new GithubExecutionTimeoutError(timedOut);
      if (leaseLost) throw new GithubLeaseLostError();
      if (controller.signal.aborted && result.status !== "cancelled") throw new GithubExecutionCancelledError();
      return result;
    } catch (error) {
      if (timedOut) throw new GithubExecutionTimeoutError(timedOut);
      if (leaseLost) throw new GithubLeaseLostError();
      if (controller.signal.aborted) throw new GithubExecutionCancelledError();
      throw error;
    } finally {
      clearTimeout(workflowTimeout);
      if (stageTimeout) clearTimeout(stageTimeout);
      clearInterval(heartbeat);
      clearInterval(interval);
    }
  }

  private async recordUsage(
    startedAt: string,
    finishedAt: string,
    projectId: string,
    work: GithubWorkItemRecord,
    result: GithubWorkDispatchResult,
    executionId: string,
  ): Promise<void> {
    const usageInput: AgentUsageInput = {
      executionId,
      projectId,
      githubIssueNumber: work.issueNumber,
      githubPullRequestNumber: typeof result.resultSummary?.pullRequestNumber === "number" ? result.resultSummary.pullRequestNumber : null,
      provider: result.provider ?? this.options.provider ?? "codex",
      startedAt,
      finishedAt,
      wallDurationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      costKind: result.usage?.costKind ?? "unknown",
      usageSource: result.usage?.usageSource ?? "unknown",
      ...(result.usage ?? {}),
      observedAt: finishedAt,
    };
    await this.options.agentUsage?.record(usageInput).catch(() => undefined);
  }

  public async reconcileProject(project: ProjectRecord): Promise<void> {
    const repository = { id: project.repositoryId ?? `unresolved:${project.id}`, owner: project.repositoryOwner, name: project.repositoryName };
    const observedAt = this.now().toISOString();
    const delayed = this.reconciliationBackoff.get(project.id);
    if (delayed && Date.parse(delayed.retryAt) > Date.parse(observedAt)) return;
    try {
      const previous = await this.options.persistence.githubWork.listForProject(project.id);
      const profile = project.repositoryId
        ? await this.options.reader.detectRepository(repository)
        : incompatibleProfile(repository, observedAt);
      const items = profile.compatible ? await this.options.reader.listWorkItems(repository) : [];
      const reconciled = await this.options.persistence.githubWork.reconcile({
        profile: toProfileInput(project.id, profile),
        items: items.map((item) => toItemInput(project.id, item)),
      });
      await this.notifyAttentionChanges(project, previous, reconciled);
      this.reconciliationBackoff.delete(project.id);
    } catch (error) {
      const retryAt = this.recordReconciliationBackoff(project.id, observedAt, error);
      await this.options.persistence.githubWork.reconcile({
        profile: toProfileInput(project.id, incompatibleProfile(repository, observedAt, "reconciliation-deferred")),
        items: [],
      }).catch(() => undefined);
      await this.options.persistence.auditEvents.append({
        occurredAt: observedAt, category: "github-work", severity: "warning", actorType: "system",
        projectId: project.id, action: "github-work.reconciliation-failed", result: "deferred",
        metadata: {
          failureCode: reconciliationFailureCode(error),
          retryAt,
        },
      });
    }
  }

  private recordReconciliationBackoff(projectId: string, observedAt: string, error: unknown): string {
    const previous = this.reconciliationBackoff.get(projectId);
    const failures = (previous?.failures ?? 0) + 1;
    const retryAt = error instanceof GithubWorkAdapterError && error.retryAt && Date.parse(error.retryAt) > Date.parse(observedAt)
      ? error.retryAt
      : new Date(Date.parse(observedAt) + Math.min(
        this.reconciliationBackoffMaxMs,
        this.reconciliationBackoffBaseMs * 2 ** Math.min(failures - 1, 8),
      )).toISOString();
    this.reconciliationBackoff.set(projectId, { failures, retryAt });
    return retryAt;
  }

  private nextReconciliationWakeUpAt(now: string): string | undefined {
    const nowMs = Date.parse(now);
    return [...this.reconciliationBackoff.values()]
      .map(({ retryAt }) => retryAt)
      .filter((retryAt) => Date.parse(retryAt) > nowMs)
      .toSorted()[0];
  }

  private async notifyAttentionChanges(
    project: ProjectRecord,
    previous: readonly GithubWorkItemRecord[],
    reconciled: readonly GithubWorkItemRecord[],
  ): Promise<void> {
    const notifier = this.options.notifier;
    if (!notifier) return;
    const previousByIssue = new Map(previous.map((item) => [item.issueNumber, item]));
    for (const work of reconciled) {
      if (!work.present || (work.state !== "waiting-human" && work.state !== "failed")) continue;
      const before = previousByIssue.get(work.issueNumber);
      const changed = before?.state !== work.state || before.sourceUpdatedAt !== work.sourceUpdatedAt;
      if (!changed) continue;
      if (work.state === "waiting-human") await notifier.waitingHuman(project, work);
      else await notifier.failure(project, work, "GITHUB_WORK_FAILED");
    }
  }
}

function selectProjectWork(profile: GithubWorkProfileRecord | null, items: readonly GithubWorkItemRecord[], now: string): GithubWorkSelection {
  if (!profile || !profile.compatible || (profile.adeStatus !== undefined && profile.adeStatus !== "compatible")) return { availability: "unknown", item: null, reason: "ADE project is not compatible." };
  return selectGithubWork(items, now);
}

function toCandidate(project: ProjectRecord, selection: GithubWorkSelection, hasActiveLease: boolean, history: readonly ExecutionRecord[], resumeEligible = false): SchedulerCandidate {
  const labels = Array.isArray(project.runnerPolicy.labels) ? project.runnerPolicy.labels.map(String) : [];
  const lastSuccess = history.find(({ status }) => status === "succeeded")?.finishedAt ?? undefined;
  const sameRevisionAttempt = !resumeEligible && selection.item !== null && history.some((execution) =>
    execution.workRef === githubWorkRef(selection.item!.issueNumber) &&
    ["succeeded", "failed", "cancelled", "unknown"].includes(execution.status) &&
    execution.resultSummary?.sourceUpdatedAt === selection.item!.sourceUpdatedAt,
  );
  return {
    project: { id: project.id, repository: `${project.repositoryOwner}/${project.repositoryName}`, priority: selection.item?.priority ?? project.priority, controlState: project.state, requiredRunnerLabels: labels },
    adeAvailability: selection.availability,
    work: selection.availability === "ready" && selection.item ? { ref: githubWorkRef(selection.item.issueNumber), cost: "long" } : null,
    hasActiveLease,
    requiresReconciliation: sameRevisionAttempt,
    ...(lastSuccess ? { lastSuccessfulExecutionAt: lastSuccess } : {}),
  };
}

function toRunner(runner: RunnerRecord): SchedulerRunner {
  return {
    id: runner.id, state: runner.state, architecture: runner.architecture, labels: runner.labels,
    capabilities: Object.entries(runner.capabilities).filter(([, value]) => value !== false && value !== null).map(([name]) => name),
    memoryClass: runner.capabilities.memoryClass === "large" || runner.capabilities.memoryClass === "medium" ? runner.capabilities.memoryClass : "small",
  };
}

function groupByProject(items: readonly GithubWorkItemRecord[]): Map<string, GithubWorkItemRecord[]> {
  const grouped = new Map<string, GithubWorkItemRecord[]>();
  for (const item of items) {
    const current = grouped.get(item.projectId) ?? [];
    current.push(item);
    grouped.set(item.projectId, current);
  }
  return grouped;
}

function githubWorkRef(issueNumber: number): string { return `github:issue:${issueNumber}`; }

class GithubExecutionCancelledError extends Error {
  public constructor() {
    super("GitHub work execution was cancelled.");
    this.name = "GithubExecutionCancelledError";
  }
}

class GithubExecutionTimeoutError extends Error {
  public constructor(public readonly kind: "stage" | "workflow") {
    super("GitHub work exceeded its deadline.");
    this.name = "GithubExecutionTimeoutError";
  }
}

class GithubLeaseLostError extends Error {
  public constructor() {
    super("GitHub work lost its execution lease.");
    this.name = "GithubLeaseLostError";
  }
}

function incompatibleProfile(
  repository: { id: string; owner: string; name: string },
  observedAt: string,
  reason: GithubWorkRepositoryProfile["reason"] = "invalid-profile",
): GithubWorkRepositoryProfile {
  return { repository, compatible: false, contractVersion: null, capabilities: [], skillPaths: [], observedAt, reason };
}

function toProfileInput(projectId: string, profile: GithubWorkRepositoryProfile) {
  return { projectId, repositoryGithubId: profile.repository.id, compatible: profile.compatible,
    contractVersion: profile.contractVersion, capabilities: profile.capabilities, skillPaths: profile.skillPaths,
    reason: profile.reason, observedAt: profile.observedAt };
}

function toItemInput(projectId: string, item: GithubWorkItem) {
  return { projectId, repositoryGithubId: item.repository.id, contractVersion: item.contractVersion,
    issueNumber: item.issueNumber, issueUrl: item.issueUrl, state: item.state, priority: item.priority,
    dependsOn: item.dependsOn, retryPolicy: item.retryPolicy, humanDecisionRef: item.humanDecisionRef,
    executionRef: item.executionRef, branchName: item.branchName, pullRequestNumber: item.pullRequestNumber,
    sourceUpdatedAt: item.sourceUpdatedAt, observedAt: item.observedAt, expiresAt: item.expiresAt };
}

function reconciliationFailureCode(error: unknown): string {
  if (!(error instanceof GithubWorkAdapterError)) return "GITHUB_RECONCILIATION_FAILED";
  if (error.status === 429) return "GITHUB_RATE_LIMITED";
  if (error.status === 403) return "GITHUB_FORBIDDEN_OR_RATE_LIMITED";
  if (error.status >= 500 && error.status <= 599) return "GITHUB_TRANSIENT_FAILURE";
  return "GITHUB_RECONCILIATION_FAILED";
}

function earliestWakeUpAt(...candidates: readonly (string | undefined)[]): string | undefined {
  return candidates.filter((candidate): candidate is string => candidate !== undefined && !Number.isNaN(Date.parse(candidate))).toSorted()[0];
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
