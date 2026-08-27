import { randomUUID } from "node:crypto";

import type {
  AuditEventInput,
  AuditEventRecord,
  ControlCommandReceiptInput,
  ControlCommandRecord,
  ControlCommandStatusUpdate,
  ControlPlanePersistence,
  ControlPlaneSettingsRecord,
  ControlPlaneSettingsUpdate,
  ExecutionRecord,
  ProjectControlState,
  ProjectRecord,
  ProjectSnapshotRecord,
  ProviderQuotaSnapshotRecord,
  RunnerRecord,
  RunnerState,
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
    projects: {
      async getById(projectId) {
        return state.projects.find(({ id }) => id === projectId) ?? null;
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
