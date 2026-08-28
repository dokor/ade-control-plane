import { randomUUID } from "node:crypto";
import { ActiveTaskConflictError } from "@ade-control-plane/database";

import type {
  AdeDecisionInput,
  AdeDecisionRecord,
  AuditEventInput,
  AuditEventRecord,
  BotCommentPurpose,
  ControlCommandReceiptInput,
  ControlCommandRecord,
  ControlCommandStatusUpdate,
  ControlPlanePersistence,
  ControlPlaneSettingsRecord,
  ControlPlaneSettingsUpdate,
  ExecutionRecord,
  GithubBotCommentRecord,
  GithubDeliveryReceiptInput,
  GithubDeliveryRecord,
  GithubWorkItemRecord,
  GithubWorkProfileRecord,
  GithubSubjectType,
  ProjectControlState,
  ProjectRecord,
  ProjectSnapshotRecord,
  ProviderQuotaSnapshotRecord,
  RunnerRecord,
  RunnerState,
  V0TaskLogRecord,
  V0TaskRecord,
} from "@ade-control-plane/database";

/**
 * In-memory persistence double used by the Dashboard unit tests.
 * Unsupported repository methods throw so a test can never silently rely on a
 * behaviour the real PostgreSQL store does not provide.
 */
export interface MemoryState {
  settings: ControlPlaneSettingsRecord;
  projects: ProjectRecord[];
  snapshots: ProjectSnapshotRecord[];
  runners: RunnerRecord[];
  executions: ExecutionRecord[];
  quotaSnapshots: ProviderQuotaSnapshotRecord[];
  commands: ControlCommandRecord[];
  auditEvents: AuditEventRecord[];
  deliveries: GithubDeliveryRecord[];
  githubWorkProfiles: GithubWorkProfileRecord[];
  githubWorkItems: GithubWorkItemRecord[];
  botComments: GithubBotCommentRecord[];
  decisions: AdeDecisionRecord[];
  v0Tasks: V0TaskRecord[];
  v0TaskLogs: V0TaskLogRecord[];
}

const NOW = "2026-08-27T10:00:00.000Z";

export function createMemoryState(overrides: Partial<MemoryState> = {}): MemoryState {
  return {
    settings: {
      schedulerMode: "running",
      quotaThrottledPercent: 70,
      quotaDrainingPercent: 85,
      quotaBlockedPercent: 95,
      quotaStaleAfterMs: 300_000,
      updatedAt: NOW,
      updatedBy: "system",
    },
    projects: [],
    snapshots: [],
    runners: [],
    executions: [],
    quotaSnapshots: [],
    commands: [],
    auditEvents: [],
    deliveries: [],
    githubWorkProfiles: [],
    githubWorkItems: [],
    botComments: [],
    decisions: [],
    v0Tasks: [],
    v0TaskLogs: [],
    ...overrides,
  };
}

function unsupported(name: string): never {
  throw new Error(`${name} is not implemented by the in-memory test store.`);
}

export function createMemoryPersistence(
  state: MemoryState,
): ControlPlanePersistence {
  return {
    v0Tasks: {
      async create(input) {
        if (
          state.v0Tasks.some(
            ({ status }) => status === "PENDING" || status === "RUNNING",
          )
        ) {
          throw new ActiveTaskConflictError();
        }
        const task: V0TaskRecord = {
          id: input.id ?? randomUUID(),
          projectId: input.projectId,
          prompt: input.prompt,
          status: "PENDING",
          cancelRequested: false,
          branchName: null,
          pullRequestNumber: null,
          pullRequestUrl: null,
          errorCode: null,
          errorSummary: null,
          createdAt: input.createdAt,
          startedAt: null,
          finishedAt: null,
          updatedAt: input.createdAt,
        };
        state.v0Tasks.push(task);
        return task;
      },
      async getById(taskId) {
        return state.v0Tasks.find(({ id }) => id === taskId) ?? null;
      },
      async list(limit) {
        return state.v0Tasks.slice(0, limit);
      },
      async claimPending(startedAt) {
        const task = state.v0Tasks.find(({ status }) => status === "PENDING");
        if (!task) return null;
        task.status = "RUNNING";
        task.startedAt = startedAt;
        task.updatedAt = startedAt;
        return task;
      },
      async requestCancel(taskId, requestedAt) {
        const task = state.v0Tasks.find(({ id }) => id === taskId);
        if (!task) throw new Error("Task not found.");
        if (task.status === "PENDING" || task.status === "RUNNING") {
          task.cancelRequested = true;
          task.updatedAt = requestedAt;
        }
        if (task.status === "PENDING") {
          task.status = "CANCELLED";
          task.finishedAt = requestedAt;
        }
        return task;
      },
      async complete(input) {
        const task = state.v0Tasks.find(({ id }) => id === input.taskId);
        if (!task) throw new Error("Task not found.");
        task.status = input.status;
        task.finishedAt = input.finishedAt;
        task.updatedAt = input.finishedAt;
        return task;
      },
      async appendLog(input) {
        const log: V0TaskLogRecord = {
          id: String(state.v0TaskLogs.length + 1),
          taskId: input.taskId,
          occurredAt: input.occurredAt,
          stream: input.stream,
          message: input.message,
        };
        state.v0TaskLogs.push(log);
        return log;
      },
      async listLogs(taskId, limit) {
        return state.v0TaskLogs
          .filter((log) => log.taskId === taskId)
          .slice(0, limit);
      },
    },
    settings: {
      async get() {
        return state.settings;
      },
      async update(update: ControlPlaneSettingsUpdate) {
        state.settings = {
          ...state.settings,
          ...(update.schedulerMode ? { schedulerMode: update.schedulerMode } : {}),
          updatedAt: update.updatedAt,
          updatedBy: update.updatedBy,
        };
        return state.settings;
      },
    },
    githubDeliveries: {
      async getByDeliveryId(deliveryId) {
        return state.deliveries.find((entry) => entry.deliveryId === deliveryId) ?? null;
      },
      async recordReceipt(input: GithubDeliveryReceiptInput) {
        const existing = state.deliveries.find(
          (entry) => entry.deliveryId === input.deliveryId,
        );
        if (existing) return { record: existing, duplicate: true };

        const record: GithubDeliveryRecord = {
          id: input.id ?? randomUUID(),
          deliveryId: input.deliveryId,
          event: input.event,
          action: input.action,
          repositoryGithubId: input.repositoryGithubId,
          projectId: input.projectId ?? null,
          actorRef: input.actorRef ?? null,
          subjectType: input.subjectType ?? null,
          subjectNumber: input.subjectNumber ?? null,
          commentId: input.commentId ?? null,
          status: "received",
          rejectionCode: null,
          controlCommandId: null,
          receivedAt: input.receivedAt,
          processedAt: null,
        };
        state.deliveries.push(record);
        return { record, duplicate: false };
      },
      async updateOutcome(id, outcome) {
        const index = state.deliveries.findIndex((entry) => entry.id === id);
        const delivery = state.deliveries[index];
        if (index < 0 || !delivery) throw new Error("Delivery not found.");
        const updated: GithubDeliveryRecord = {
          ...delivery,
          status: outcome.status,
          rejectionCode: outcome.rejectionCode ?? delivery.rejectionCode,
          controlCommandId: outcome.controlCommandId ?? delivery.controlCommandId,
          processedAt: outcome.processedAt ?? delivery.processedAt,
        };
        state.deliveries[index] = updated;
        return updated;
      },
      async listRecent(limit) {
        return state.deliveries.slice(0, limit);
      },
    },
    githubWork: {
      async getProfile(projectId) {
        return state.githubWorkProfiles.find((profile) => profile.projectId === projectId) ?? null;
      },
      async listForProject(projectId) {
        return state.githubWorkItems.filter((item) => item.projectId === projectId);
      },
      async listForProjects(projectIds) {
        return state.githubWorkItems.filter((item) => projectIds.includes(item.projectId));
      },
      async reconcile(input) {
        const profile: GithubWorkProfileRecord = {
          projectId: input.profile.projectId,
          repositoryGithubId: input.profile.repositoryGithubId,
          compatible: input.profile.compatible,
          contractVersion: input.profile.contractVersion ?? null,
          capabilities: input.profile.capabilities ?? [],
          skillPaths: input.profile.skillPaths ?? [],
          reason: input.profile.reason,
          observedAt: input.profile.observedAt,
        };
        const profileIndex = state.githubWorkProfiles.findIndex((entry) => entry.projectId === profile.projectId);
        if (profileIndex >= 0) state.githubWorkProfiles[profileIndex] = profile;
        else state.githubWorkProfiles.push(profile);
        state.githubWorkItems = state.githubWorkItems.map((item) =>
          item.projectId === profile.projectId ? { ...item, present: false } : item,
        );
        for (const inputItem of input.items) {
          const item: GithubWorkItemRecord = {
            id: state.githubWorkItems.find((entry) =>
              entry.projectId === inputItem.projectId && entry.issueNumber === inputItem.issueNumber,
            )?.id ?? randomUUID(),
            ...inputItem,
            humanDecisionRef: inputItem.humanDecisionRef ?? null,
            executionRef: inputItem.executionRef ?? null,
            branchName: inputItem.branchName ?? null,
            pullRequestNumber: inputItem.pullRequestNumber ?? null,
            present: true,
          };
          const index = state.githubWorkItems.findIndex((entry) =>
            entry.projectId === item.projectId && entry.issueNumber === item.issueNumber,
          );
          if (index >= 0) state.githubWorkItems[index] = item;
          else state.githubWorkItems.push(item);
        }
        return state.githubWorkItems.filter((item) => item.projectId === profile.projectId);
      },
    },
    githubBotComments: {
      async find(
        projectId: string,
        purpose: BotCommentPurpose,
        subjectType: GithubSubjectType,
        subjectNumber: number,
      ) {
        return (
          state.botComments.find(
            (entry) =>
              entry.projectId === projectId &&
              entry.purpose === purpose &&
              entry.subjectType === subjectType &&
              entry.subjectNumber === subjectNumber,
          ) ?? null
        );
      },
      async remember(record: GithubBotCommentRecord) {
        const index = state.botComments.findIndex(
          (entry) =>
            entry.projectId === record.projectId &&
            entry.purpose === record.purpose &&
            entry.subjectType === record.subjectType &&
            entry.subjectNumber === record.subjectNumber,
        );
        if (index >= 0) state.botComments[index] = record;
        else state.botComments.push(record);
        return record;
      },
    },
    adeDecisions: {
      async getByRef(projectId, decisionRef) {
        return (
          state.decisions.find(
            (entry) =>
              entry.projectId === projectId && entry.decisionRef === decisionRef,
          ) ?? null
        );
      },
      async listOpenByProjectId(projectId) {
        return state.decisions.filter(
          (entry) => entry.projectId === projectId && entry.status === "open",
        );
      },
      async upsert(input: AdeDecisionInput) {
        const record: AdeDecisionRecord = {
          id: input.id ?? randomUUID(),
          projectId: input.projectId,
          decisionRef: input.decisionRef,
          prompt: input.prompt,
          options: [...input.options],
          status: input.status ?? "open",
          resolvedOption: null,
          resolvedBy: null,
          observedAt: input.observedAt,
          resolvedAt: null,
        };
        state.decisions.push(record);
        return record;
      },
      async resolve(projectId, decisionRef, option, resolvedBy, resolvedAt) {
        const index = state.decisions.findIndex(
          (entry) =>
            entry.projectId === projectId &&
            entry.decisionRef === decisionRef &&
            entry.status === "open",
        );
        const decision = state.decisions[index];
        if (index < 0 || !decision) return null;

        const updated: AdeDecisionRecord = {
          ...decision,
          status: "resolved",
          resolvedOption: option,
          resolvedBy,
          resolvedAt,
        };
        state.decisions[index] = updated;
        return updated;
      },
    },
    projects: {
      async getById(projectId) {
        return state.projects.find(({ id }) => id === projectId) ?? null;
      },
      async getByRepositoryId(repositoryId) {
        return state.projects.find((entry) => entry.repositoryId === repositoryId) ?? null;
      },
      async list() {
        return [...state.projects];
      },
      async register() {
        return unsupported("projects.register");
      },
      async updatePriority(projectId, priority) {
        return mutateProject(state, projectId, (project) => ({ ...project, priority }));
      },
      async updateState(projectId, projectState: ProjectControlState) {
        return mutateProject(state, projectId, (project) => ({
          ...project,
          state: projectState,
        }));
      },
    },
    projectSnapshots: {
      async append() {
        return unsupported("projectSnapshots.append");
      },
      async getLatestByProjectId(projectId) {
        return state.snapshots.find((snapshot) => snapshot.projectId === projectId) ?? null;
      },
      async listLatestForProjects(projectIds) {
        return state.snapshots.filter((snapshot) =>
          projectIds.includes(snapshot.projectId),
        );
      },
    },
    runners: {
      async getById(runnerId) {
        return state.runners.find(({ id }) => id === runnerId) ?? null;
      },
      async list() {
        return [...state.runners];
      },
      async register() {
        return unsupported("runners.register");
      },
      async recordHeartbeat() {
        return unsupported("runners.recordHeartbeat");
      },
      async updateState(runnerId, runnerState: RunnerState) {
        const index = state.runners.findIndex(({ id }) => id === runnerId);
        const runner = state.runners[index];
        if (index < 0 || !runner) throw new Error("Runner not found.");
        const updated = { ...runner, state: runnerState };
        state.runners[index] = updated;
        return updated;
      },
    },
    executions: {
      async getById(executionId) {
        return state.executions.find(({ id }) => id === executionId) ?? null;
      },
      async listActive() {
        return state.executions.filter(({ status }) =>
          ["queued", "leased", "dispatched", "running"].includes(status),
        );
      },
      async listByProjectId(projectId, limit) {
        return state.executions
          .filter((execution) => execution.projectId === projectId)
          .slice(0, limit);
      },
      async markDispatched() {
        return unsupported("executions.markDispatched");
      },
      async markRunning() {
        return unsupported("executions.markRunning");
      },
      async scheduleWithLease() {
        return unsupported("executions.scheduleWithLease");
      },
      async complete() {
        return unsupported("executions.complete");
      },
      async listReconciliationCandidates() {
        return [];
      },
    },
    executionLeases: {
      async getActiveByLeaseKey() {
        return null;
      },
      async heartbeat() {
        return unsupported("executionLeases.heartbeat");
      },
      async listStale() {
        return [];
      },
      async releaseByExecutionId() {
        return null;
      },
    },
    providerQuotaSnapshots: {
      async append() {
        return unsupported("providerQuotaSnapshots.append");
      },
      async getLatest(provider, accountRef) {
        return (
          state.quotaSnapshots.find(
            (snapshot) =>
              snapshot.provider === provider && snapshot.accountRef === accountRef,
          ) ?? null
        );
      },
    },
    controlCommands: {
      async getById(commandId) {
        return state.commands.find(({ id }) => id === commandId) ?? null;
      },
      async list() {
        return [...state.commands];
      },
      async listForProject(projectId, limit) {
        return state.commands
          .filter((command) => command.projectId === projectId)
          .slice(0, limit);
      },
      async recordReceipt(input: ControlCommandReceiptInput) {
        const existing = input.idempotencyKey
          ? state.commands.find(
              (command) =>
                command.idempotencyKey === input.idempotencyKey &&
                command.source === input.source,
            )
          : undefined;
        if (existing) return existing;

        const record: ControlCommandRecord = {
          id: input.id ?? randomUUID(),
          source: input.source,
          actorType: input.actorType,
          actorRef: input.actorRef,
          projectId: input.projectId ?? null,
          commandType: input.commandType,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey ?? null,
          status: "received",
          receivedAt: input.receivedAt,
          appliedAt: null,
          resultSummary: null,
        };
        state.commands.push(record);
        return record;
      },
      async updateStatus(commandId, update: ControlCommandStatusUpdate) {
        const index = state.commands.findIndex(({ id }) => id === commandId);
        const command = state.commands[index];
        if (index < 0 || !command) throw new Error("Command not found.");
        const updated: ControlCommandRecord = {
          ...command,
          status: update.status,
          appliedAt: update.appliedAt ?? command.appliedAt,
          resultSummary: update.resultSummary ?? command.resultSummary,
        };
        state.commands[index] = updated;
        return updated;
      },
    },
    auditEvents: {
      async append(input: AuditEventInput) {
        const record: AuditEventRecord = {
          id: input.id ?? randomUUID(),
          occurredAt: input.occurredAt,
          category: input.category,
          severity: input.severity,
          actorType: input.actorType,
          actorRef: input.actorRef ?? null,
          projectId: input.projectId ?? null,
          executionId: input.executionId ?? null,
          runnerId: input.runnerId ?? null,
          action: input.action,
          reason: input.reason ?? null,
          result: input.result ?? null,
          correlationId: input.correlationId ?? null,
          metadata: input.metadata ?? {},
        };
        state.auditEvents.push(record);
        return record;
      },
      async listForExecution(executionId) {
        return state.auditEvents.filter((event) => event.executionId === executionId);
      },
      async listForProject(projectId, limit) {
        return state.auditEvents
          .filter((event) => event.projectId === projectId)
          .slice(0, limit);
      },
      async listRecent(limit) {
        return state.auditEvents.slice(0, limit);
      },
    },
    async close() {},
    async migrate() {
      return [];
    },
  };
}

function mutateProject(
  state: MemoryState,
  projectId: string,
  update: (project: ProjectRecord) => ProjectRecord,
): ProjectRecord {
  const index = state.projects.findIndex(({ id }) => id === projectId);
  const project = state.projects[index];
  if (index < 0 || !project) throw new Error("Project not found.");
  const updated = update(project);
  state.projects[index] = updated;
  return updated;
}
