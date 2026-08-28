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
import type { GithubWorkItem, GithubWorkReader, GithubWorkRepositoryProfile } from "@ade-control-plane/github";

export interface GithubWorkDispatchRequest {
  executionId: string;
  project: ProjectRecord;
  work: GithubWorkItemRecord;
  skillPaths: readonly string[];
}

export interface GithubWorkDispatchResult {
  status: "succeeded" | "failed" | "cancelled";
  resultSummary?: Record<string, string | number>;
  errorCode?: string;
  errorSummary?: string;
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
  leaseDurationMs?: number;
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

  public constructor(private readonly options: GithubWorkOrchestratorOptions) {
    this.now = options.now ?? (() => new Date());
    this.leaseDurationMs = options.leaseDurationMs ?? 15 * 60 * 1_000;
  }

  public async reconcileAll(): Promise<void> {
    const projects = await this.options.persistence.projects.list();
    for (const project of projects) await this.reconcileProject(project);
  }

  public async runCycle(): Promise<GithubWorkCycleResult> {
    await this.reconcileAll();
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
    const selections = new Map(projects.map((project) => [project.id,
      selectProjectWork(profilesByProject.get(project.id) ?? null, itemsByProject.get(project.id) ?? [], now),
    ]));
    const decision = evaluateSchedule({
      mode: settings.schedulerMode,
      now,
      quota: { state: quota?.policyState ?? (this.options.allowStartWithoutQuotaSnapshot ? "normal" : "unknown"), ...(quota?.resetsAt ? { resetsAt: quota.resetsAt } : {}) },
      candidates: projects.map((project) => toCandidate(
        project,
        selections.get(project.id)!,
        activeByProject.has(project.id),
        historyByProject.get(project.id) ?? [],
      )),
      runners: runners.map(toRunner),
    });
    if (!decision.selected) {
      return { outcome: "idle", reason: decision.reason, ...(decision.nextWakeUpAt ? { nextWakeUpAt: decision.nextWakeUpAt } : {}) };
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
        capability: "github-work.codex",
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
      const result = await this.options.dispatcher.execute({
        executionId: scheduled.execution.id,
        project,
        work,
        skillPaths: profile.skillPaths,
      });
      await store.executions.complete({
        executionId: scheduled.execution.id,
        status: result.status,
        finishedAt: this.now().toISOString(),
        resultSummary: {
          ...(result.resultSummary ?? {}),
          sourceUpdatedAt: selection.item.sourceUpdatedAt,
          issueNumber: selection.item.issueNumber,
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
      if (result.status === "failed") {
        await this.options.notifier?.failure(project, work, result.errorCode ?? "EXECUTION_FAILED");
      }
    } catch {
      await store.executions.complete({
        executionId: scheduled.execution.id, status: "failed", finishedAt: this.now().toISOString(),
        errorCode: "AGENT_DISPATCH_FAILED", errorSummary: "The code-agent dispatch failed.",
        releaseReason: "github-work-dispatch-failed",
        auditEvent: {
          occurredAt: this.now().toISOString(), category: "execution", severity: "warning", actorType: "system",
          projectId: project.id, runnerId: decision.selected.runnerId,
          action: "github-work.dispatch-failed", result: "failed", metadata: { issueNumber: selection.item.issueNumber },
        },
      });
      await this.options.notifier?.failure(project, work, "AGENT_DISPATCH_FAILED");
    }
    return { outcome: "dispatched", projectId: project.id, issueNumber: selection.item.issueNumber, executionId };
  }

  private async reconcileProject(project: ProjectRecord): Promise<void> {
    const repository = { id: project.repositoryId ?? `unresolved:${project.id}`, owner: project.repositoryOwner, name: project.repositoryName };
    const observedAt = this.now().toISOString();
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
    } catch {
      await this.options.persistence.auditEvents.append({
        occurredAt: observedAt, category: "github-work", severity: "warning", actorType: "system",
        projectId: project.id, action: "github-work.reconciliation-failed", result: "deferred",
        metadata: {},
      });
    }
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
  if (!profile || !profile.compatible) return { availability: "unknown", item: null, reason: "GitHub work profile is unavailable." };
  return selectGithubWork(items, now);
}

function toCandidate(project: ProjectRecord, selection: GithubWorkSelection, hasActiveLease: boolean, history: readonly ExecutionRecord[]): SchedulerCandidate {
  const labels = Array.isArray(project.runnerPolicy.labels) ? project.runnerPolicy.labels.map(String) : [];
  const lastSuccess = history.find(({ status }) => status === "succeeded")?.finishedAt ?? undefined;
  const sameRevisionAttempt = selection.item !== null && history.some((execution) =>
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

function incompatibleProfile(repository: { id: string; owner: string; name: string }, observedAt: string): GithubWorkRepositoryProfile {
  return { repository, compatible: false, contractVersion: null, capabilities: [], skillPaths: [], observedAt, reason: "invalid-profile" };
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
