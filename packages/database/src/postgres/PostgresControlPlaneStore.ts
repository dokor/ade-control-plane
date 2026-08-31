import { randomUUID } from "node:crypto";

import type { Notification, Pool } from "pg";

import type {
  AdeDecisionInput,
  AdeDecisionRepository,
  AuditEventInput,
  AuditEventRepository,
  ControlCommandReceiptInput,
  ControlCommandRepository,
  ControlCommandStatusUpdate,
  ControlPlanePersistence,
  ControlPlaneSettingsRepository,
  ControlPlaneSettingsUpdate,
  ExecutionCompletionInput,
  ExecutionLeaseRepository,
  ExecutionRepository,
  GithubBotCommentRepository,
  GithubDeliveryOutcome,
  GithubDeliveryReceipt,
  GithubDeliveryReceiptInput,
  GithubDeliveryRepository,
  GithubWorkReconciliationInput,
  GithubWorkRepository,
  LeaseAcquisitionInput,
  ProjectRegistrationInput,
  ProjectRepository,
  ProjectSnapshotInput,
  ProjectSnapshotRepository,
  ProviderQuotaSnapshotInput,
  ProviderQuotaSnapshotRepository,
  RunnerRegistrationInput,
  RunnerRepository,
  ScheduleExecutionWithLeaseInput,
  V0TaskCreateInput,
  V0TaskLogInput,
  V0TaskRepository,
  WorkerWakeup,
  WorkerWakeupRepository,
  V0TaskTransitionInput,
  AgentUsageInput,
  AgentUsageRepository,
  AgentUsageQuery,
} from "../contracts.js";
import type {
  AdeDecisionRecord,
  AdeDecisionStatus,
  AuditEventRecord,
  BotCommentPurpose,
  CompletionResult,
  ControlCommandRecord,
  ControlPlaneSettingsRecord,
  ExecutionLeaseRecord,
  ExecutionRecord,
  AgentUsageRecord,
  GithubBotCommentRecord,
  GithubDeliveryRecord,
  GithubDeliveryStatus,
  GithubWorkItemRecord,
  GithubWorkItemState,
  GithubWorkProfileReason,
  GithubWorkProfileRecord,
  AdeProjectCompatibilityState,
  GithubWorkRetryPolicy,
  GithubSubjectType,
  JsonObject,
  JsonValue,
  ProjectControlState,
  ProjectRecord,
  ProjectSnapshotRecord,
  ProviderQuotaSnapshotRecord,
  ReconciliationCandidate,
  RunnerRecord,
  RunnerState,
  ScheduledExecutionRecord,
  SchedulerMode,
  V0TaskLogRecord,
  V0TaskRecord,
  V0TaskSource,
} from "../domain.js";
import {
  ActiveTaskConflictError,
  DatabaseRecordNotFoundError,
  ExecutionCompletionConflictError,
  LeaseConflictError,
} from "../errors.js";
import {
  createPool,
  expectOne,
  type PostgresConnectionConfig,
  type SqlQueryable,
  withTransaction,
} from "./connection.js";
import { migrate as runMigrations } from "./migrations.js";

type TimestampRow = { [key: string]: unknown };

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function toJsonObject(value: unknown): JsonObject {
  return (value ?? {}) as JsonObject;
}

function toJsonValue(value: unknown): JsonValue {
  return (value ?? null) as JsonValue;
}

function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry));
}

/** Clamps caller-provided page sizes so a Dashboard request cannot scan a table. */
function boundedLimit(limit: number, maximum = 200): number {
  return Math.min(Math.max(Math.trunc(limit) || 1, 1), maximum);
}

function mapProject(row: TimestampRow): ProjectRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    repositoryOwner: String(row.repository_owner),
    repositoryName: String(row.repository_name),
    repositoryId: row.repository_id === null ? null : String(row.repository_id),
    state: row.state as ProjectControlState,
    priority: Number(row.priority),
    adeAdapter: String(row.ade_adapter),
    runnerPolicy: toJsonObject(row.runner_policy),
    configuration: toJsonObject(row.configuration),
    createdAt: toIsoString(row.created_at) ?? "",
    updatedAt: toIsoString(row.updated_at) ?? "",
  };
}

function mapProjectSnapshot(row: TimestampRow): ProjectSnapshotRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    adeRunId: row.ade_run_id === null ? null : String(row.ade_run_id),
    status: String(row.status),
    stage: row.stage === null ? null : String(row.stage),
    milestone: row.milestone === null ? null : String(row.milestone),
    currentWorkRef:
      row.current_work_ref === null ? null : String(row.current_work_ref),
    currentWorkSummary:
      row.current_work_summary === null
        ? null
        : String(row.current_work_summary),
    nextWorkRef: row.next_work_ref === null ? null : String(row.next_work_ref),
    nextWorkSummary:
      row.next_work_summary === null ? null : String(row.next_work_summary),
    waitingReason:
      row.waiting_reason === null ? null : String(row.waiting_reason),
    requiresHuman: Boolean(row.requires_human),
    observedAt: toIsoString(row.observed_at) ?? "",
    expiresAt: toIsoString(row.expires_at),
  };
}

function mapRunner(row: TimestampRow): RunnerRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind),
    state: row.state as RunnerState,
    architecture: String(row.architecture),
    capabilities: toJsonObject(row.capabilities),
    labels: toStringArray(row.labels),
    lastHeartbeatAt: toIsoString(row.last_heartbeat_at),
    createdAt: toIsoString(row.created_at) ?? "",
    updatedAt: toIsoString(row.updated_at) ?? "",
  };
}

function mapExecution(row: TimestampRow): ExecutionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    runnerId: row.runner_id === null ? null : String(row.runner_id),
    adeExecutionRef:
      row.ade_execution_ref === null ? null : String(row.ade_execution_ref),
    workRef: row.work_ref === null ? null : String(row.work_ref),
    capability: String(row.capability),
    status: row.status as ExecutionRecord["status"],
    attempt: Number(row.attempt),
    requestedAt: toIsoString(row.requested_at) ?? "",
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
    resultSummary:
      row.result_summary === null ? null : toJsonObject(row.result_summary),
    errorCode: row.error_code === null ? null : String(row.error_code),
    errorSummary: row.error_summary === null ? null : String(row.error_summary),
    createdAt: toIsoString(row.created_at) ?? "",
    updatedAt: toIsoString(row.updated_at) ?? "",
  };
}

function mapAgentUsage(row: TimestampRow): AgentUsageRecord {
  const optionalNumber = (key: string): number | undefined =>
    row[key] === null || row[key] === undefined ? undefined : Number(String(row[key]));
  const record: AgentUsageRecord = {
    id: String(row.id),
    executionId: row.execution_id === null ? null : String(row.execution_id),
    taskId: row.task_id === null ? null : String(row.task_id),
    projectId: String(row.project_id),
    githubIssueNumber: row.github_issue_number === null ? null : Number(row.github_issue_number),
    githubPullRequestNumber: row.github_pull_request_number === null ? null : Number(row.github_pull_request_number),
    provider: String(row.provider),
    ...(row.model === null ? {} : { model: String(row.model) }),
    startedAt: toIsoString(row.started_at) ?? "",
    finishedAt: toIsoString(row.finished_at),
    wallDurationMs: row.wall_duration_ms === null ? null : Number(String(row.wall_duration_ms)),
    ...(row.cost_amount === null ? {} : { costAmount: Number(String(row.cost_amount)) }),
    ...(row.cost_currency === null ? {} : { costCurrency: String(row.cost_currency) }),
    costKind: String(row.cost_kind) as AgentUsageRecord["costKind"],
    usageSource: String(row.usage_source),
    ...(row.provider_execution_ref === null ? {} : { providerExecutionRef: String(row.provider_execution_ref) }),
    observedAt: toIsoString(row.observed_at) ?? "",
  };
  const numberFields: readonly [string, keyof AgentUsageRecord][] = [
    ["provider_duration_ms", "providerDurationMs"], ["provider_api_duration_ms", "providerApiDurationMs"],
    ["turn_count", "turnCount"], ["input_tokens", "inputTokens"], ["cached_input_tokens", "cachedInputTokens"],
    ["cache_write_input_tokens", "cacheWriteInputTokens"], ["output_tokens", "outputTokens"],
    ["reasoning_output_tokens", "reasoningOutputTokens"], ["total_tokens", "totalTokens"],
  ];
  for (const [column, field] of numberFields) {
    const value = optionalNumber(column);
    if (value !== undefined) record[field] = value as never;
  }
  return record;
}

function mapV0Task(row: TimestampRow): V0TaskRecord {
  const source: V0TaskSource = row.source_type === "github-issue" &&
    Number.isInteger(Number(row.github_issue_number)) &&
    Number(row.github_issue_number) > 0
    ? { type: "github-issue", issueNumber: Number(row.github_issue_number) }
    : { type: "prompt", prompt: String(row.prompt) };
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    source,
    prompt: String(row.prompt),
    status: row.status as V0TaskRecord["status"],
    cancelRequested: Boolean(row.cancel_requested),
    branchName: row.branch_name === null ? null : String(row.branch_name),
    headSha: row.head_sha === null || row.head_sha === undefined ? null : String(row.head_sha),
    prRetryRequested: Boolean(row.pr_retry_requested),
    adeProvenance: row.ade_provenance === null || row.ade_provenance === undefined ? null : toJsonObject(row.ade_provenance),
    pullRequestNumber:
      row.pull_request_number === null ? null : Number(row.pull_request_number),
    pullRequestUrl: row.pull_request_url === null ? null : String(row.pull_request_url),
    errorCode: row.error_code === null ? null : String(row.error_code),
    errorSummary: row.error_summary === null ? null : String(row.error_summary),
    createdAt: toIsoString(row.created_at) ?? "",
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
    updatedAt: toIsoString(row.updated_at) ?? "",
  };
}

function mapV0TaskLog(row: TimestampRow): V0TaskLogRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    occurredAt: toIsoString(row.occurred_at) ?? "",
    stream: row.stream as V0TaskLogRecord["stream"],
    message: String(row.message),
  };
}

function mapLease(row: TimestampRow): ExecutionLeaseRecord {
  return {
    id: String(row.id),
    executionId: String(row.execution_id),
    projectId: String(row.project_id),
    runnerId: row.runner_id === null ? null : String(row.runner_id),
    ownerId: String(row.owner_id),
    leaseKey: String(row.lease_key),
    acquiredAt: toIsoString(row.acquired_at) ?? "",
    heartbeatAt: toIsoString(row.heartbeat_at) ?? "",
    expiresAt: toIsoString(row.expires_at) ?? "",
    releasedAt: toIsoString(row.released_at),
    releaseReason:
      row.release_reason === null ? null : String(row.release_reason),
  };
}

function mapProviderQuotaSnapshot(row: TimestampRow): ProviderQuotaSnapshotRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    accountRef: String(row.account_ref),
    policyState: row.policy_state as ProviderQuotaSnapshotRecord["policyState"],
    usedPercent:
      row.used_percent === null ? null : Number(String(row.used_percent)),
    windowDurationMins:
      row.window_duration_mins === null || row.window_duration_mins === undefined
        ? null
        : Number(String(row.window_duration_mins)),
    windowStartedAt: toIsoString(row.window_started_at),
    resetsAt: toIsoString(row.resets_at),
    observedAt: toIsoString(row.observed_at) ?? "",
    expiresAt: toIsoString(row.expires_at),
    metadata: toJsonObject(row.metadata),
  };
}

function mapControlCommand(row: TimestampRow): ControlCommandRecord {
  return {
    id: String(row.id),
    source: row.source as ControlCommandRecord["source"],
    actorType: String(row.actor_type),
    actorRef: String(row.actor_ref),
    projectId: row.project_id === null ? null : String(row.project_id),
    commandType: String(row.command_type),
    payload: toJsonValue(row.payload),
    idempotencyKey:
      row.idempotency_key === null ? null : String(row.idempotency_key),
    status: row.status as ControlCommandRecord["status"],
    receivedAt: toIsoString(row.received_at) ?? "",
    appliedAt: toIsoString(row.applied_at),
    resultSummary:
      row.result_summary === null ? null : toJsonObject(row.result_summary),
  };
}

function mapAuditEvent(row: TimestampRow): AuditEventRecord {
  return {
    id: String(row.id),
    occurredAt: toIsoString(row.occurred_at) ?? "",
    category: String(row.category),
    severity: String(row.severity),
    actorType: String(row.actor_type),
    actorRef: row.actor_ref === null ? null : String(row.actor_ref),
    projectId: row.project_id === null ? null : String(row.project_id),
    executionId: row.execution_id === null ? null : String(row.execution_id),
    runnerId: row.runner_id === null ? null : String(row.runner_id),
    action: String(row.action),
    reason: row.reason === null ? null : String(row.reason),
    result: row.result === null ? null : String(row.result),
    correlationId:
      row.correlation_id === null ? null : String(row.correlation_id),
    metadata: toJsonObject(row.metadata),
  };
}

function serializeJson(value: JsonObject | JsonValue | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function sameJson(left: JsonObject | null, right: JsonObject | null | undefined): boolean {
  if (left === null && (right === null || right === undefined)) {
    return true;
  }

  return serializeJson(left) === serializeJson(right ?? null);
}

async function queryOptional<Row extends TimestampRow>(
  queryable: SqlQueryable,
  sql: string,
  values: unknown[],
): Promise<Row | null> {
  const result = await queryable.query<Row>(sql, values);
  return result.rows[0] ?? null;
}

async function queryRequired<Row extends TimestampRow>(
  queryable: SqlQueryable,
  sql: string,
  values: unknown[],
  notFoundMessage: string,
): Promise<Row> {
  const result = await queryable.query<Row>(sql, values);
  return expectOne(result.rows, notFoundMessage);
}

function mapGithubDelivery(row: TimestampRow): GithubDeliveryRecord {
  return {
    id: String(row.id),
    deliveryId: String(row.delivery_id),
    event: String(row.event),
    action: String(row.action),
    repositoryGithubId: String(row.repository_github_id),
    projectId: row.project_id === null ? null : String(row.project_id),
    actorRef: row.actor_ref === null ? null : String(row.actor_ref),
    subjectType: row.subject_type === null ? null : (row.subject_type as GithubSubjectType),
    subjectNumber: row.subject_number === null ? null : Number(row.subject_number),
    commentId: row.comment_id === null ? null : String(row.comment_id),
    status: row.status as GithubDeliveryStatus,
    rejectionCode: row.rejection_code === null ? null : String(row.rejection_code),
    controlCommandId:
      row.control_command_id === null ? null : String(row.control_command_id),
    receivedAt: toIsoString(row.received_at) ?? "",
    processedAt: toIsoString(row.processed_at),
  };
}

function mapGithubBotComment(row: TimestampRow): GithubBotCommentRecord {
  return {
    projectId: String(row.project_id),
    purpose: row.purpose as BotCommentPurpose,
    subjectType: row.subject_type as GithubSubjectType,
    subjectNumber: Number(row.subject_number),
    commentId: String(row.comment_id),
    updatedAt: toIsoString(row.updated_at) ?? "",
  };
}

function mapGithubWorkProfile(row: TimestampRow): GithubWorkProfileRecord {
  const adeStatus = row.ade_status as AdeProjectCompatibilityState | null | undefined;
  return {
    projectId: String(row.project_id),
    repositoryGithubId: String(row.repository_github_id),
    compatible: Boolean(row.compatible),
    contractVersion: row.contract_version === null ? null : String(row.contract_version),
    capabilities: toStringArray(row.capabilities),
    skillPaths: toStringArray(row.skill_paths),
    reason: row.reason as GithubWorkProfileReason,
    observedAt: toIsoString(row.observed_at) ?? "",
    adeStatus: adeStatus ?? (row.compatible ? "compatible" : row.reason === "missing-profile" ? "setup-required" : "incompatible"),
    adeConfigVersion: row.ade_config_version === null || row.ade_config_version === undefined ? null : String(row.ade_config_version),
    adeRuntimeVersion: row.ade_runtime_version === null || row.ade_runtime_version === undefined ? null : String(row.ade_runtime_version),
    resolvedProfiles: row.resolved_profiles ? toStringArray(row.resolved_profiles) : [],
    resolvedRules: row.resolved_rules ? toStringArray(row.resolved_rules) : [],
    contextStatus: (row.context_status as GithubWorkProfileRecord["contextStatus"] | null | undefined) ?? "unknown",
  };
}

function mapGithubWorkItem(row: TimestampRow): GithubWorkItemRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    repositoryGithubId: String(row.repository_github_id),
    contractVersion: String(row.contract_version),
    issueNumber: Number(row.issue_number),
    issueUrl: String(row.issue_url),
    state: row.state as GithubWorkItemState,
    priority: Number(row.priority),
    dependsOn: toStringArray(row.depends_on).map(Number).filter(Number.isSafeInteger),
    retryPolicy: row.retry_policy as GithubWorkRetryPolicy,
    humanDecisionRef: row.human_decision_ref === null ? null : String(row.human_decision_ref),
    executionRef: row.execution_ref === null ? null : String(row.execution_ref),
    branchName: row.branch_name === null ? null : String(row.branch_name),
    pullRequestNumber: row.pull_request_number === null ? null : Number(row.pull_request_number),
    sourceUpdatedAt: toIsoString(row.source_updated_at) ?? "",
    observedAt: toIsoString(row.observed_at) ?? "",
    expiresAt: toIsoString(row.expires_at) ?? "",
    present: Boolean(row.present),
  };
}

function mapAdeDecision(row: TimestampRow): AdeDecisionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    decisionRef: String(row.decision_ref),
    prompt: String(row.prompt),
    options: toStringArray(row.options),
    status: row.status as AdeDecisionStatus,
    resolvedOption: row.resolved_option === null ? null : String(row.resolved_option),
    resolvedBy: row.resolved_by === null ? null : String(row.resolved_by),
    observedAt: toIsoString(row.observed_at) ?? "",
    resolvedAt: toIsoString(row.resolved_at),
  };
}

class PostgresGithubDeliveryRepository implements GithubDeliveryRepository {
  public constructor(private readonly pool: Pool) {}

  public async getByDeliveryId(deliveryId: string): Promise<GithubDeliveryRecord | null> {
    const row = await queryOptional(
      this.pool,
      "SELECT * FROM github_deliveries WHERE delivery_id = $1",
      [deliveryId],
    );
    return row ? mapGithubDelivery(row) : null;
  }

  public async recordReceipt(
    input: GithubDeliveryReceiptInput,
  ): Promise<GithubDeliveryReceipt> {
    const inserted = await queryOptional(
      this.pool,
      `
        INSERT INTO github_deliveries (
          id, delivery_id, event, action, repository_github_id, project_id,
          actor_ref, subject_type, subject_number, comment_id, status, received_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'received', $11)
        ON CONFLICT (delivery_id) DO NOTHING
        RETURNING *
      `,
      [
        input.id ?? randomUUID(),
        input.deliveryId,
        input.event,
        input.action,
        input.repositoryGithubId,
        input.projectId ?? null,
        input.actorRef ?? null,
        input.subjectType ?? null,
        input.subjectNumber ?? null,
        input.commentId ?? null,
        input.receivedAt,
      ],
    );

    if (inserted) {
      return { record: mapGithubDelivery(inserted), duplicate: false };
    }

    const existing = await queryRequired(
      this.pool,
      "SELECT * FROM github_deliveries WHERE delivery_id = $1",
      [input.deliveryId],
      "Duplicate GitHub delivery could not be read back.",
    );
    return { record: mapGithubDelivery(existing), duplicate: true };
  }

  public async updateOutcome(
    id: string,
    outcome: GithubDeliveryOutcome,
  ): Promise<GithubDeliveryRecord> {
    const row = await queryRequired(
      this.pool,
      `
        UPDATE github_deliveries
        SET status = $2,
            rejection_code = COALESCE($3, rejection_code),
            control_command_id = COALESCE($4, control_command_id),
            processed_at = COALESCE($5, processed_at)
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        outcome.status,
        outcome.rejectionCode ?? null,
        outcome.controlCommandId ?? null,
        outcome.processedAt ?? null,
      ],
      "GitHub delivery could not be updated.",
    );
    return mapGithubDelivery(row);
  }

  public async listRecent(limit: number): Promise<readonly GithubDeliveryRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM github_deliveries ORDER BY received_at DESC LIMIT $1",
      [boundedLimit(limit)],
    );
    return result.rows.map(mapGithubDelivery);
  }
}

class PostgresGithubBotCommentRepository implements GithubBotCommentRepository {
  public constructor(private readonly pool: Pool) {}

  public async find(
    projectId: string,
    purpose: BotCommentPurpose,
    subjectType: GithubSubjectType,
    subjectNumber: number,
  ): Promise<GithubBotCommentRecord | null> {
    const row = await queryOptional(
      this.pool,
      `
        SELECT *
        FROM github_bot_comments
        WHERE project_id = $1 AND purpose = $2
          AND subject_type = $3 AND subject_number = $4
      `,
      [projectId, purpose, subjectType, subjectNumber],
    );
    return row ? mapGithubBotComment(row) : null;
  }

  public async remember(
    record: GithubBotCommentRecord,
  ): Promise<GithubBotCommentRecord> {
    const row = await queryRequired(
      this.pool,
      `
        INSERT INTO github_bot_comments (
          project_id, purpose, subject_type, subject_number, comment_id, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (project_id, purpose, subject_type, subject_number)
        DO UPDATE SET comment_id = EXCLUDED.comment_id, updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        record.projectId,
        record.purpose,
        record.subjectType,
        record.subjectNumber,
        record.commentId,
        record.updatedAt,
      ],
      "Bot comment mapping could not be stored.",
    );
    return mapGithubBotComment(row);
  }
}

class PostgresGithubWorkRepository implements GithubWorkRepository {
  public constructor(private readonly pool: Pool) {}

  public async getProfile(projectId: string): Promise<GithubWorkProfileRecord | null> {
    const row = await queryOptional(this.pool, "SELECT * FROM github_work_profiles WHERE project_id = $1", [projectId]);
    return row ? mapGithubWorkProfile(row) : null;
  }

  public async listForProject(projectId: string): Promise<readonly GithubWorkItemRecord[]> {
    return this.listForProjects([projectId]);
  }

  public async listForProjects(projectIds: readonly string[]): Promise<readonly GithubWorkItemRecord[]> {
    if (projectIds.length === 0) return [];
    const result = await this.pool.query(
      "SELECT * FROM github_work_items WHERE project_id = ANY($1::uuid[]) ORDER BY project_id ASC, priority DESC, issue_number ASC",
      [[...projectIds]],
    );
    return result.rows.map(mapGithubWorkItem);
  }

  public async reconcile(input: GithubWorkReconciliationInput): Promise<readonly GithubWorkItemRecord[]> {
    return withTransaction(this.pool, async (client) => {
      const profile = input.profile;
      await client.query(
        `INSERT INTO github_work_profiles (project_id, repository_github_id, compatible, contract_version, capabilities, skill_paths, reason, observed_at, ade_status, ade_config_version, ade_runtime_version, resolved_profiles, resolved_rules, context_status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)
         ON CONFLICT (project_id) DO UPDATE SET
           repository_github_id = EXCLUDED.repository_github_id, compatible = EXCLUDED.compatible,
           contract_version = EXCLUDED.contract_version, capabilities = EXCLUDED.capabilities,
           skill_paths = EXCLUDED.skill_paths, reason = EXCLUDED.reason, observed_at = EXCLUDED.observed_at,
           ade_status = EXCLUDED.ade_status, ade_config_version = EXCLUDED.ade_config_version,
           ade_runtime_version = EXCLUDED.ade_runtime_version, resolved_profiles = EXCLUDED.resolved_profiles,
           resolved_rules = EXCLUDED.resolved_rules, context_status = EXCLUDED.context_status`,
        [profile.projectId, profile.repositoryGithubId, profile.compatible, profile.contractVersion ?? null,
          JSON.stringify(profile.capabilities ?? []), JSON.stringify(profile.skillPaths ?? []), profile.reason, profile.observedAt,
          profile.adeStatus ?? (profile.compatible ? "compatible" : profile.reason === "missing-profile" ? "setup-required" : "incompatible"),
          profile.adeConfigVersion ?? null, profile.adeRuntimeVersion ?? null,
          JSON.stringify(profile.resolvedProfiles ?? []), JSON.stringify(profile.resolvedRules ?? []), profile.contextStatus ?? "unknown"],
      );
      await client.query("UPDATE github_work_items SET present = false WHERE project_id = $1", [profile.projectId]);
      for (const item of input.items) {
        await client.query(
          `INSERT INTO github_work_items (id, project_id, repository_github_id, contract_version, issue_number, issue_url, state, priority, depends_on, retry_policy, human_decision_ref, execution_ref, branch_name, pull_request_number, source_updated_at, observed_at, expires_at, present)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, true)
           ON CONFLICT (project_id, issue_number) DO UPDATE SET
             repository_github_id = EXCLUDED.repository_github_id, contract_version = EXCLUDED.contract_version,
             issue_url = EXCLUDED.issue_url, state = EXCLUDED.state, priority = EXCLUDED.priority,
             depends_on = EXCLUDED.depends_on, retry_policy = EXCLUDED.retry_policy,
             human_decision_ref = EXCLUDED.human_decision_ref, execution_ref = EXCLUDED.execution_ref,
             branch_name = EXCLUDED.branch_name, pull_request_number = EXCLUDED.pull_request_number,
             source_updated_at = EXCLUDED.source_updated_at, observed_at = EXCLUDED.observed_at,
             expires_at = EXCLUDED.expires_at, present = true`,
          [randomUUID(), item.projectId, item.repositoryGithubId, item.contractVersion, item.issueNumber,
            item.issueUrl, item.state, item.priority, JSON.stringify(item.dependsOn), item.retryPolicy,
            item.humanDecisionRef ?? null, item.executionRef ?? null, item.branchName ?? null,
            item.pullRequestNumber ?? null, item.sourceUpdatedAt, item.observedAt, item.expiresAt],
        );
      }
      const result = await client.query(
        "SELECT * FROM github_work_items WHERE project_id = $1 ORDER BY priority DESC, issue_number ASC",
        [profile.projectId],
      );
      return result.rows.map(mapGithubWorkItem);
    });
  }
}

class PostgresAdeDecisionRepository implements AdeDecisionRepository {
  public constructor(private readonly pool: Pool) {}

  public async getByRef(
    projectId: string,
    decisionRef: string,
  ): Promise<AdeDecisionRecord | null> {
    const row = await queryOptional(
      this.pool,
      "SELECT * FROM ade_decisions WHERE project_id = $1 AND decision_ref = $2",
      [projectId, decisionRef],
    );
    return row ? mapAdeDecision(row) : null;
  }

  public async listOpenByProjectId(
    projectId: string,
  ): Promise<readonly AdeDecisionRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM ade_decisions
        WHERE project_id = $1 AND status = 'open'
        ORDER BY observed_at DESC
      `,
      [projectId],
    );
    return result.rows.map(mapAdeDecision);
  }

  public async upsert(input: AdeDecisionInput): Promise<AdeDecisionRecord> {
    const row = await queryRequired(
      this.pool,
      `
        INSERT INTO ade_decisions (
          id, project_id, decision_ref, prompt, options, status, observed_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        ON CONFLICT (project_id, decision_ref)
        DO UPDATE SET prompt = EXCLUDED.prompt,
                      options = EXCLUDED.options,
                      observed_at = EXCLUDED.observed_at
        RETURNING *
      `,
      [
        input.id ?? randomUUID(),
        input.projectId,
        input.decisionRef,
        input.prompt,
        JSON.stringify([...input.options]),
        input.status ?? "open",
        input.observedAt,
      ],
      "ADE decision could not be stored.",
    );
    return mapAdeDecision(row);
  }

  public async resolve(
    projectId: string,
    decisionRef: string,
    option: string,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<AdeDecisionRecord | null> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE ade_decisions
        SET status = 'resolved',
            resolved_option = $3,
            resolved_by = $4,
            resolved_at = $5
        WHERE project_id = $1 AND decision_ref = $2 AND status = 'open'
        RETURNING *
      `,
      [projectId, decisionRef, option, resolvedBy, resolvedAt],
    );
    return row ? mapAdeDecision(row) : null;
  }
}

function mapControlPlaneSettings(row: TimestampRow): ControlPlaneSettingsRecord {
  return {
    schedulerMode: row.scheduler_mode as SchedulerMode,
    quotaThrottledPercent: Number(row.quota_throttled_percent),
    quotaDrainingPercent: Number(row.quota_draining_percent),
    quotaBlockedPercent: Number(row.quota_blocked_percent),
    quotaStaleAfterMs: Number(row.quota_stale_after_ms),
    updatedAt: toIsoString(row.updated_at) ?? "",
    updatedBy: row.updated_by === null ? null : String(row.updated_by),
  };
}

class PostgresControlPlaneSettingsRepository
  implements ControlPlaneSettingsRepository
{
  public constructor(private readonly pool: Pool) {}

  public async get(): Promise<ControlPlaneSettingsRecord> {
    const row = await queryRequired(
      this.pool,
      "SELECT * FROM control_plane_settings WHERE id = 'singleton'",
      [],
      "Control plane settings row is missing; run migrations.",
    );
    return mapControlPlaneSettings(row);
  }

  public async update(
    update: ControlPlaneSettingsUpdate,
  ): Promise<ControlPlaneSettingsRecord> {
    const row = await queryRequired(
      this.pool,
      `
        UPDATE control_plane_settings
        SET
          scheduler_mode = COALESCE($1, scheduler_mode),
          quota_throttled_percent = COALESCE($2, quota_throttled_percent),
          quota_draining_percent = COALESCE($3, quota_draining_percent),
          quota_blocked_percent = COALESCE($4, quota_blocked_percent),
          quota_stale_after_ms = COALESCE($5, quota_stale_after_ms),
          updated_at = $6,
          updated_by = $7
        WHERE id = 'singleton'
        RETURNING *
      `,
      [
        update.schedulerMode ?? null,
        update.quotaThrottledPercent ?? null,
        update.quotaDrainingPercent ?? null,
        update.quotaBlockedPercent ?? null,
        update.quotaStaleAfterMs ?? null,
        update.updatedAt,
        update.updatedBy,
      ],
      "Failed to update control plane settings.",
    );
    return mapControlPlaneSettings(row);
  }
}

class PostgresProjectRepository implements ProjectRepository {
  public constructor(private readonly pool: Pool) {}

  public async getByRepositoryId(repositoryId: string): Promise<ProjectRecord | null> {
    const row = await queryOptional(
      this.pool,
      "SELECT * FROM projects WHERE repository_id = $1",
      [repositoryId],
    );
    return row ? mapProject(row) : null;
  }

  public async getById(projectId: string): Promise<ProjectRecord | null> {
    const row = await queryOptional(
      this.pool,
      "SELECT * FROM projects WHERE id = $1",
      [projectId],
    );
    return row ? mapProject(row) : null;
  }

  public async list(): Promise<readonly ProjectRecord[]> {
    const result = await this.pool.query(
      `
        SELECT * FROM projects
        ORDER BY priority DESC, created_at ASC
      `,
    );
    return result.rows.map(mapProject);
  }

  public async register(input: ProjectRegistrationInput): Promise<ProjectRecord> {
    const timestamp = input.createdAt ?? new Date().toISOString();
    const row = await queryRequired(
      this.pool,
      `
        INSERT INTO projects (
          id,
          slug,
          name,
          repository_owner,
          repository_name,
          repository_id,
          state,
          priority,
          ade_adapter,
          runner_policy,
          configuration,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)
        RETURNING *
      `,
      [
        input.id ?? randomUUID(),
        input.slug,
        input.name,
        input.repositoryOwner,
        input.repositoryName,
        input.repositoryId ?? null,
        input.state ?? "enabled",
        input.priority,
        input.adeAdapter,
        JSON.stringify(input.runnerPolicy ?? {}),
        JSON.stringify(input.configuration ?? {}),
        timestamp,
        input.updatedAt ?? timestamp,
      ],
      "Failed to insert project.",
    );

    return mapProject(row);
  }

  public async updatePriority(
    projectId: string,
    priority: number,
  ): Promise<ProjectRecord> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE projects
        SET priority = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [projectId, priority],
    );
    if (!row) {
      throw new DatabaseRecordNotFoundError(
        `Project ${projectId} was not found.`,
      );
    }

    return mapProject(row);
  }

  public async updateState(
    projectId: string,
    state: ProjectControlState,
  ): Promise<ProjectRecord> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE projects
        SET state = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [projectId, state],
    );
    if (!row) {
      throw new DatabaseRecordNotFoundError(
        `Project ${projectId} was not found.`,
      );
    }

    return mapProject(row);
  }
}

class PostgresProjectSnapshotRepository implements ProjectSnapshotRepository {
  public constructor(private readonly pool: Pool) {}

  public async append(input: ProjectSnapshotInput): Promise<ProjectSnapshotRecord> {
    const row = await queryRequired(
      this.pool,
      `
        INSERT INTO project_snapshots (
          id,
          project_id,
          ade_run_id,
          status,
          stage,
          milestone,
          current_work_ref,
          current_work_summary,
          next_work_ref,
          next_work_summary,
          waiting_reason,
          requires_human,
          observed_at,
          expires_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        RETURNING *
      `,
      [
        input.id ?? randomUUID(),
        input.projectId,
        input.adeRunId ?? null,
        input.status,
        input.stage ?? null,
        input.milestone ?? null,
        input.currentWorkRef ?? null,
        input.currentWorkSummary ?? null,
        input.nextWorkRef ?? null,
        input.nextWorkSummary ?? null,
        input.waitingReason ?? null,
        input.requiresHuman ?? false,
        input.observedAt,
        input.expiresAt ?? null,
      ],
      "Failed to insert project snapshot.",
    );
    return mapProjectSnapshot(row);
  }

  public async getLatestByProjectId(
    projectId: string,
  ): Promise<ProjectSnapshotRecord | null> {
    const row = await queryOptional(
      this.pool,
      `
        SELECT *
        FROM project_snapshots
        WHERE project_id = $1
        ORDER BY observed_at DESC
        LIMIT 1
      `,
      [projectId],
    );
    return row ? mapProjectSnapshot(row) : null;
  }

  public async listLatestForProjects(
    projectIds: readonly string[],
  ): Promise<readonly ProjectSnapshotRecord[]> {
    if (projectIds.length === 0) {
      return [];
    }

    const result = await this.pool.query(
      `
        SELECT DISTINCT ON (project_id) *
        FROM project_snapshots
        WHERE project_id = ANY($1::uuid[])
        ORDER BY project_id, observed_at DESC
      `,
      [[...projectIds]],
    );
    return result.rows.map(mapProjectSnapshot);
  }
}

class PostgresRunnerRepository implements RunnerRepository {
  public constructor(private readonly pool: Pool) {}

  public async getById(runnerId: string): Promise<RunnerRecord | null> {
    const row = await queryOptional(
      this.pool,
      "SELECT * FROM runners WHERE id = $1",
      [runnerId],
    );
    return row ? mapRunner(row) : null;
  }

  public async list(): Promise<readonly RunnerRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM runners ORDER BY created_at ASC",
    );
    return result.rows.map(mapRunner);
  }

  public async register(input: RunnerRegistrationInput): Promise<RunnerRecord> {
    const timestamp = input.createdAt ?? new Date().toISOString();
    const row = await queryRequired(
      this.pool,
      `
        INSERT INTO runners (
          id,
          name,
          kind,
          state,
          architecture,
          capabilities,
          labels,
          last_heartbeat_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
        RETURNING *
      `,
      [
        input.id ?? randomUUID(),
        input.name,
        input.kind,
        input.state ?? "online",
        input.architecture,
        JSON.stringify(input.capabilities ?? {}),
        JSON.stringify(input.labels ?? []),
        input.lastHeartbeatAt ?? null,
        timestamp,
        input.updatedAt ?? timestamp,
      ],
      "Failed to insert runner.",
    );
    return mapRunner(row);
  }

  public async recordHeartbeat(
    runnerId: string,
    heartbeatAt: string,
  ): Promise<RunnerRecord> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE runners
        SET last_heartbeat_at = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [runnerId, heartbeatAt],
    );
    if (!row) {
      throw new DatabaseRecordNotFoundError(`Runner ${runnerId} was not found.`);
    }

    return mapRunner(row);
  }

  public async updateState(
    runnerId: string,
    state: RunnerState,
  ): Promise<RunnerRecord> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE runners
        SET state = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [runnerId, state],
    );
    if (!row) {
      throw new DatabaseRecordNotFoundError(`Runner ${runnerId} was not found.`);
    }

    return mapRunner(row);
  }
}

class PostgresExecutionLeaseRepository implements ExecutionLeaseRepository {
  public constructor(private readonly pool: Pool) {}

  public async getActiveByLeaseKey(
    leaseKey: string,
  ): Promise<ExecutionLeaseRecord | null> {
    const row = await queryOptional(
      this.pool,
      `
        SELECT *
        FROM execution_leases
        WHERE lease_key = $1 AND released_at IS NULL
      `,
      [leaseKey],
    );
    return row ? mapLease(row) : null;
  }

  public async heartbeat(
    executionId: string,
    ownerId: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<ExecutionLeaseRecord> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE execution_leases
        SET heartbeat_at = $3, expires_at = $4
        WHERE execution_id = $1
          AND owner_id = $2
          AND released_at IS NULL
        RETURNING *
      `,
      [executionId, ownerId, heartbeatAt, expiresAt],
    );
    if (!row) {
      throw new DatabaseRecordNotFoundError(
        `Active lease for execution ${executionId} and owner ${ownerId} was not found.`,
      );
    }

    return mapLease(row);
  }

  public async listStale(asOf: string): Promise<readonly ExecutionLeaseRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM execution_leases
        WHERE released_at IS NULL
          AND expires_at < $1
        ORDER BY expires_at ASC
      `,
      [asOf],
    );
    return result.rows.map(mapLease);
  }

  public async releaseByExecutionId(
    executionId: string,
    releaseReason: string,
    releasedAt: string,
  ): Promise<ExecutionLeaseRecord | null> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE execution_leases
        SET released_at = $2, release_reason = $3
        WHERE execution_id = $1
          AND released_at IS NULL
        RETURNING *
      `,
      [executionId, releasedAt, releaseReason],
    );
    return row ? mapLease(row) : null;
  }
}

class PostgresExecutionRepository implements ExecutionRepository {
  public constructor(private readonly pool: Pool) {}

  public async getById(executionId: string): Promise<ExecutionRecord | null> {
    const row = await queryOptional(
      this.pool,
      "SELECT * FROM executions WHERE id = $1",
      [executionId],
    );
    return row ? mapExecution(row) : null;
  }

  public async markDispatched(
    executionId: string,
    startedAt: string,
  ): Promise<ExecutionRecord> {
    return this.updateInFlightStatus(executionId, "dispatched", startedAt);
  }

  public async markRunning(
    executionId: string,
    startedAt: string,
  ): Promise<ExecutionRecord> {
    return this.updateInFlightStatus(executionId, "running", startedAt);
  }

  public async listActive(): Promise<readonly ExecutionRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM executions
        WHERE status IN ('queued', 'leased', 'dispatched', 'running')
        ORDER BY requested_at DESC
      `,
    );
    return result.rows.map(mapExecution);
  }

  public async listByProjectId(
    projectId: string,
    limit: number,
  ): Promise<readonly ExecutionRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM executions
        WHERE project_id = $1
        ORDER BY requested_at DESC
        LIMIT $2
      `,
      [projectId, boundedLimit(limit)],
    );
    return result.rows.map(mapExecution);
  }

  public async scheduleWithLease(
    input: ScheduleExecutionWithLeaseInput,
  ): Promise<ScheduledExecutionRecord | null> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const execution = await insertExecution(client, input.execution);
        const lease = await insertLease(client, execution.id, input.lease);

        if (!lease) {
          throw new LeaseConflictError(
            `Lease ${input.lease.leaseKey} is already held by another execution.`,
          );
        }

        const updatedExecutionRow = await queryRequired(
          client,
          `
            UPDATE executions
            SET status = 'leased', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
          `,
          [execution.id],
          `Execution ${execution.id} disappeared during lease acquisition.`,
        );

        return {
          execution: mapExecution(updatedExecutionRow),
          lease: mapLease(lease),
        };
      });
    } catch (error) {
      if (error instanceof LeaseConflictError) {
        return null;
      }

      throw error;
    }
  }

  public async complete(input: ExecutionCompletionInput): Promise<CompletionResult> {
    return withTransaction(this.pool, async (client) => {
      const executionRow = await queryRequired(
        client,
        `
          SELECT *
          FROM executions
          WHERE id = $1
          FOR UPDATE
        `,
        [input.executionId],
        `Execution ${input.executionId} was not found.`,
      );
      const currentExecution = mapExecution(executionRow);

      if (isTerminalStatus(currentExecution.status)) {
        const isSameCompletion =
          currentExecution.status === input.status &&
          currentExecution.finishedAt === input.finishedAt &&
          sameJson(currentExecution.resultSummary, input.resultSummary ?? null) &&
          currentExecution.errorCode === (input.errorCode ?? null) &&
          currentExecution.errorSummary === (input.errorSummary ?? null);

        if (!isSameCompletion) {
          throw new ExecutionCompletionConflictError(
            `Execution ${input.executionId} is already terminal as ${currentExecution.status}.`,
          );
        }

        return {
          execution: currentExecution,
          applied: false,
          releasedLease: false,
        };
      }

      const updatedExecutionRow = await queryRequired(
        client,
        `
          UPDATE executions
          SET
            status = $2,
            finished_at = $3,
            result_summary = $4::jsonb,
            error_code = $5,
            error_summary = $6,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `,
        [
          input.executionId,
          input.status,
          input.finishedAt,
          serializeJson(input.resultSummary ?? null),
          input.errorCode ?? null,
          input.errorSummary ?? null,
        ],
        `Execution ${input.executionId} could not be completed.`,
      );

      const releasedLeaseRow = await queryOptional(
        client,
        `
          UPDATE execution_leases
          SET released_at = $2, release_reason = $3
          WHERE execution_id = $1
            AND released_at IS NULL
          RETURNING *
        `,
        [input.executionId, input.finishedAt, input.releaseReason],
      );

      if (input.auditEvent) {
        await insertAuditEvent(client, {
          ...input.auditEvent,
          executionId: input.executionId,
          projectId: input.auditEvent.projectId ?? currentExecution.projectId,
        });
      }

      return {
        execution: mapExecution(updatedExecutionRow),
        applied: true,
        releasedLease: releasedLeaseRow !== null,
      };
    });
  }

  public async listReconciliationCandidates(
    asOf: string,
  ): Promise<readonly ReconciliationCandidate[]> {
    const result = await this.pool.query<TimestampRow>(
      `
        SELECT
          e.*,
          l.id AS lease_id,
          l.execution_id AS lease_execution_id,
          l.project_id AS lease_project_id,
          l.runner_id AS lease_runner_id,
          l.owner_id,
          l.lease_key,
          l.acquired_at,
          l.heartbeat_at,
          l.expires_at,
          l.released_at,
          l.release_reason
        FROM executions e
        LEFT JOIN execution_leases l
          ON l.execution_id = e.id
         AND l.released_at IS NULL
        WHERE e.status = 'unknown'
           OR (
             e.status NOT IN ('succeeded', 'failed', 'cancelled', 'unknown')
             AND l.id IS NOT NULL
             AND l.expires_at < $1
           )
        ORDER BY e.requested_at ASC
      `,
      [asOf],
    );

    return result.rows.map((row) => {
      const execution = mapExecution(row);
      const hasLease = row.lease_id !== null && row.lease_id !== undefined;
      const lease = hasLease
        ? mapLease({
            id: row.lease_id,
            execution_id: row.lease_execution_id,
            project_id: row.lease_project_id,
            runner_id: row.lease_runner_id,
            owner_id: row.owner_id,
            lease_key: row.lease_key,
            acquired_at: row.acquired_at,
            heartbeat_at: row.heartbeat_at,
            expires_at: row.expires_at,
            released_at: row.released_at,
            release_reason: row.release_reason,
          })
        : null;

      return {
        execution,
        lease,
        reason: execution.status === "unknown" ? "unknown-execution" : "stale-lease",
      };
    });
  }

  private async updateInFlightStatus(
    executionId: string,
    status: "dispatched" | "running",
    startedAt: string,
  ): Promise<ExecutionRecord> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE executions
        SET status = $2, started_at = COALESCE(started_at, $3), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [executionId, status, startedAt],
    );
    if (!row) {
      throw new DatabaseRecordNotFoundError(
        `Execution ${executionId} was not found.`,
      );
    }

    return mapExecution(row);
  }
}

class PostgresAgentUsageRepository implements AgentUsageRepository {
  public constructor(private readonly pool: Pool) {}

  public async record(input: AgentUsageInput): Promise<AgentUsageRecord> {
    const row = await queryRequired(
      this.pool,
      `
        INSERT INTO agent_usage (
          id, execution_id, task_id, project_id, github_issue_number,
          github_pull_request_number, provider, model, started_at, finished_at,
          wall_duration_ms, provider_duration_ms, provider_api_duration_ms,
          turn_count, input_tokens, cached_input_tokens, cache_write_input_tokens,
          output_tokens, reasoning_output_tokens, total_tokens, cost_amount,
          cost_currency, cost_kind, usage_source, provider_execution_ref, observed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
        RETURNING *
      `,
      [
        input.id ?? randomUUID(), input.executionId ?? null, input.taskId ?? null,
        input.projectId, input.githubIssueNumber ?? null, input.githubPullRequestNumber ?? null,
        input.provider, input.model ?? null, input.startedAt, input.finishedAt ?? null,
        input.wallDurationMs ?? null, input.providerDurationMs ?? null, input.providerApiDurationMs ?? null,
        input.turnCount ?? null, input.inputTokens ?? null, input.cachedInputTokens ?? null,
        input.cacheWriteInputTokens ?? null, input.outputTokens ?? null,
        input.reasoningOutputTokens ?? null, input.totalTokens ?? null,
        input.costAmount ?? null, input.costCurrency ?? null, input.costKind ?? "unknown",
        input.usageSource ?? "unknown", input.providerExecutionRef ?? null, input.observedAt,
      ],
      "Failed to record agent usage.",
    );
    return mapAgentUsage(row);
  }

  public async list(query: AgentUsageQuery = {}): Promise<readonly AgentUsageRecord[]> {
    const values: unknown[] = [];
    const clauses: string[] = [];
    const add = (clause: string, value: unknown): void => {
      values.push(value);
      clauses.push(clause.replace("$VALUE", `$${values.length}`));
    };
    if (query.projectId) add("project_id = $VALUE", query.projectId);
    if (query.provider) add("provider = $VALUE", query.provider);
    if (query.from) add("observed_at >= $VALUE", query.from);
    if (query.to) add("observed_at < $VALUE", query.to);
    values.push(boundedLimit(query.limit ?? 2000, 5000));
    const result = await this.pool.query<TimestampRow>(
      `SELECT * FROM agent_usage ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY observed_at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(mapAgentUsage);
  }
}

class PostgresProviderQuotaSnapshotRepository
  implements ProviderQuotaSnapshotRepository
{
  public constructor(private readonly pool: Pool) {}

  public async append(
    input: ProviderQuotaSnapshotInput,
  ): Promise<ProviderQuotaSnapshotRecord> {
    const row = await queryRequired(
      this.pool,
      `
        INSERT INTO provider_quota_snapshots (
          id,
          provider,
          account_ref,
          policy_state,
          used_percent,
          window_duration_mins,
          window_started_at,
          resets_at,
          observed_at,
          expires_at,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        RETURNING *
      `,
      [
        input.id ?? randomUUID(),
        input.provider,
        input.accountRef,
        input.policyState,
        input.usedPercent ?? null,
        input.windowDurationMins ?? null,
        input.windowStartedAt ?? null,
        input.resetsAt ?? null,
        input.observedAt,
        input.expiresAt ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
      "Failed to insert provider quota snapshot.",
    );
    return mapProviderQuotaSnapshot(row);
  }

  public async getLatest(
    provider: string,
    accountRef: string,
  ): Promise<ProviderQuotaSnapshotRecord | null> {
    const row = await queryOptional(
      this.pool,
      `
        SELECT *
        FROM provider_quota_snapshots
        WHERE provider = $1 AND account_ref = $2
        ORDER BY observed_at DESC
        LIMIT 1
      `,
      [provider, accountRef],
    );
    return row ? mapProviderQuotaSnapshot(row) : null;
  }

  public async deleteOlderThan(
    provider: string,
    accountRef: string,
    before: string,
  ): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM provider_quota_snapshots AS snapshot
        WHERE snapshot.provider = $1
          AND snapshot.account_ref = $2
          AND snapshot.observed_at < $3
          AND snapshot.id <> (
            SELECT latest.id
            FROM provider_quota_snapshots AS latest
            WHERE latest.provider = $1 AND latest.account_ref = $2
            ORDER BY latest.observed_at DESC
            LIMIT 1
          )
      `,
      [provider, accountRef, before],
    );
  }
}

class PostgresControlCommandRepository implements ControlCommandRepository {
  public constructor(private readonly pool: Pool) {}

  public async getById(commandId: string): Promise<ControlCommandRecord | null> {
    const row = await queryOptional(
      this.pool,
      "SELECT * FROM control_commands WHERE id = $1",
      [commandId],
    );
    return row ? mapControlCommand(row) : null;
  }

  public async list(): Promise<readonly ControlCommandRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM control_commands ORDER BY received_at ASC",
    );
    return result.rows.map(mapControlCommand);
  }

  public async listForProject(
    projectId: string,
    limit: number,
  ): Promise<readonly ControlCommandRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM control_commands
        WHERE project_id = $1
        ORDER BY received_at DESC
        LIMIT $2
      `,
      [projectId, boundedLimit(limit)],
    );
    return result.rows.map(mapControlCommand);
  }

  public async recordReceipt(
    input: ControlCommandReceiptInput,
  ): Promise<ControlCommandRecord> {
    const commandId = input.id ?? randomUUID();
    const inserted = await queryOptional(
      this.pool,
      `
        INSERT INTO control_commands (
          id,
          source,
          actor_type,
          actor_ref,
          project_id,
          command_type,
          payload,
          idempotency_key,
          status,
          received_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'received', $9)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [
        commandId,
        input.source,
        input.actorType,
        input.actorRef,
        input.projectId ?? null,
        input.commandType,
        JSON.stringify(input.payload),
        input.idempotencyKey ?? null,
        input.receivedAt,
      ],
    );

    if (inserted) {
      return mapControlCommand(inserted);
    }

    if (!input.idempotencyKey) {
      throw new Error("Control command insert failed without an idempotency key.");
    }

    const existing = await queryRequired(
      this.pool,
      `
        SELECT *
        FROM control_commands
        WHERE source = $1
          AND idempotency_key = $2
      `,
      [input.source, input.idempotencyKey],
      `Existing command not found for ${input.source}:${input.idempotencyKey}.`,
    );

    return mapControlCommand(existing);
  }

  public async updateStatus(
    commandId: string,
    update: ControlCommandStatusUpdate,
  ): Promise<ControlCommandRecord> {
    const row = await queryOptional(
      this.pool,
      `
        UPDATE control_commands
        SET
          status = $2,
          applied_at = $3,
          result_summary = $4::jsonb
        WHERE id = $1
        RETURNING *
      `,
      [
        commandId,
        update.status,
        update.appliedAt ?? null,
        serializeJson(update.resultSummary ?? null),
      ],
    );

    if (!row) {
      throw new DatabaseRecordNotFoundError(
        `Control command ${commandId} was not found.`,
      );
    }

    return mapControlCommand(row);
  }
}

class PostgresAuditEventRepository implements AuditEventRepository {
  public constructor(private readonly pool: Pool) {}

  public async append(input: AuditEventInput): Promise<AuditEventRecord> {
    const row = await insertAuditEvent(this.pool, input);
    return mapAuditEvent(row);
  }

  public async listForExecution(
    executionId: string,
  ): Promise<readonly AuditEventRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM audit_events
        WHERE execution_id = $1
        ORDER BY occurred_at ASC
      `,
      [executionId],
    );
    return result.rows.map(mapAuditEvent);
  }

  public async listForProject(
    projectId: string,
    limit: number,
  ): Promise<readonly AuditEventRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM audit_events
        WHERE project_id = $1
        ORDER BY occurred_at DESC
        LIMIT $2
      `,
      [projectId, boundedLimit(limit)],
    );
    return result.rows.map(mapAuditEvent);
  }

  public async listRecent(limit: number): Promise<readonly AuditEventRecord[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM audit_events
        ORDER BY occurred_at DESC
        LIMIT $1
      `,
      [boundedLimit(limit)],
    );
    return result.rows.map(mapAuditEvent);
  }
}

async function insertExecution(
  queryable: SqlQueryable,
  input: ScheduleExecutionWithLeaseInput["execution"],
): Promise<ExecutionRecord> {
  const row = await queryRequired(
    queryable,
    `
      INSERT INTO executions (
        id,
        project_id,
        runner_id,
        ade_execution_ref,
        work_ref,
        capability,
        status,
        attempt,
        requested_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8)
      RETURNING *
    `,
    [
      input.id ?? randomUUID(),
      input.projectId,
      input.runnerId ?? null,
      input.adeExecutionRef ?? null,
      input.workRef ?? null,
      input.capability,
      input.attempt ?? 1,
      input.requestedAt,
    ],
    "Failed to insert execution intent.",
  );

  return mapExecution(row);
}

async function insertLease(
  queryable: SqlQueryable,
  executionId: string,
  input: LeaseAcquisitionInput,
): Promise<TimestampRow | null> {
  return queryOptional(
    queryable,
    `
      INSERT INTO execution_leases (
        id,
        execution_id,
        project_id,
        runner_id,
        owner_id,
        lease_key,
        acquired_at,
        heartbeat_at,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [
      input.id ?? randomUUID(),
      executionId,
      input.projectId,
      input.runnerId ?? null,
      input.ownerId,
      input.leaseKey,
      input.acquiredAt,
      input.heartbeatAt,
      input.expiresAt,
    ],
  );
}

async function insertAuditEvent(
  queryable: SqlQueryable,
  input: AuditEventInput,
): Promise<TimestampRow> {
  return queryRequired(
    queryable,
    `
      INSERT INTO audit_events (
        id,
        occurred_at,
        category,
        severity,
        actor_type,
        actor_ref,
        project_id,
        execution_id,
        runner_id,
        action,
        reason,
        result,
        correlation_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      RETURNING *
    `,
    [
      input.id ?? randomUUID(),
      input.occurredAt,
      input.category,
      input.severity,
      input.actorType,
      input.actorRef ?? null,
      input.projectId ?? null,
      input.executionId ?? null,
      input.runnerId ?? null,
      input.action,
      input.reason ?? null,
      input.result ?? null,
      input.correlationId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
    "Failed to insert audit event.",
  );
}

class PostgresV0TaskRepository implements V0TaskRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: V0TaskCreateInput): Promise<V0TaskRecord> {
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 20_000) {
      throw new Error("Task prompt must contain between 1 and 20000 characters.");
    }
    const source = input.source ?? { type: "prompt", prompt };
    if (source.type === "github-issue" &&
      (!Number.isInteger(source.issueNumber) || source.issueNumber < 1)) {
      throw new Error("GitHub issue number must be a positive integer.");
    }
    try {
      const result = await this.pool.query<TimestampRow>(
        `INSERT INTO v0_tasks
           (id, project_id, prompt, source_type, github_issue_number, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $6) RETURNING *`,
        [
          input.id ?? randomUUID(),
          input.projectId,
          prompt,
          source.type,
          source.type === "github-issue" ? source.issueNumber : null,
          input.createdAt,
        ],
      );
      return mapV0Task(expectOne(result.rows, "Failed to create V0 task."));
    } catch (error) {
      if (isUniqueViolation(error, "v0_tasks_single_active_idx")) {
        throw new ActiveTaskConflictError();
      }
      throw error;
    }
  }

  public async getById(taskId: string): Promise<V0TaskRecord | null> {
    const result = await this.pool.query<TimestampRow>(
      "SELECT * FROM v0_tasks WHERE id = $1",
      [taskId],
    );
    return result.rows[0] ? mapV0Task(result.rows[0]) : null;
  }

  public async list(limit: number): Promise<readonly V0TaskRecord[]> {
    const result = await this.pool.query<TimestampRow>(
      "SELECT * FROM v0_tasks ORDER BY created_at DESC, id DESC LIMIT $1",
      [boundedLimit(limit, 100)],
    );
    return result.rows.map(mapV0Task);
  }

  public async claimPending(startedAt: string): Promise<V0TaskRecord | null> {
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query<TimestampRow>(
        "SELECT id FROM v0_tasks WHERE status = 'PENDING' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      const row = selected.rows[0];
      if (!row) return null;
      const updated = await client.query<TimestampRow>(
        "UPDATE v0_tasks SET status = 'RUNNING', started_at = $2, updated_at = $2 WHERE id = $1 AND status = 'PENDING' RETURNING *",
        [row.id, startedAt],
      );
      return updated.rows[0] ? mapV0Task(updated.rows[0]) : null;
    });
  }

  public async requestCancel(taskId: string, requestedAt: string): Promise<V0TaskRecord> {
    const result = await this.pool.query<TimestampRow>(
      `UPDATE v0_tasks SET cancel_requested = true,
       status = CASE WHEN status = 'PENDING' THEN 'CANCELLED' ELSE status END,
       finished_at = CASE WHEN status = 'PENDING' THEN $2 ELSE finished_at END,
       updated_at = $2
       WHERE id = $1 AND status IN ('PENDING', 'RUNNING') RETURNING *`,
      [taskId, requestedAt],
    );
    const row = result.rows[0];
    if (row) return mapV0Task(row);
    const current = await this.getById(taskId);
    if (!current) {
      throw new DatabaseRecordNotFoundError(`V0 task ${taskId} was not found.`);
    }
    return current;
  }

  public async complete(input: V0TaskTransitionInput): Promise<V0TaskRecord> {
    const result = await this.pool.query<TimestampRow>(
      `UPDATE v0_tasks SET status = $2, finished_at = $3, updated_at = $3,
       branch_name = COALESCE($4, branch_name), head_sha = COALESCE($5, head_sha),
       pull_request_number = COALESCE($6, pull_request_number), pull_request_url = COALESCE($7, pull_request_url),
       error_code = $8, error_summary = $9, ade_provenance = COALESCE($10::jsonb, ade_provenance), pr_retry_requested = false
       WHERE id = $1 AND (status = 'RUNNING' OR (status = 'FAILED' AND pr_retry_requested = true)) RETURNING *`,
      [
        input.taskId,
        input.status,
        input.finishedAt,
        input.branchName ?? null,
        input.headSha ?? null,
        input.pullRequestNumber ?? null,
        input.pullRequestUrl ?? null,
        input.errorCode ?? null,
        truncateUtf8(sanitizeV0Log(input.errorSummary ?? ""), 4096) || null,
        input.adeProvenance ? JSON.stringify(input.adeProvenance) : null,
      ],
    );
    const updated = result.rows[0];
    if (updated) return mapV0Task(updated);
    const current = await this.getById(input.taskId);
    if (!current) {
      throw new DatabaseRecordNotFoundError(`V0 task ${input.taskId} was not found.`);
    }
    if (current.status !== input.status) {
      throw new ExecutionCompletionConflictError(
        `V0 task ${input.taskId} is already ${current.status}.`,
      );
    }
    return current;
  }

  public async markPushed(input: { taskId: string; branchName: string; headSha: string }): Promise<V0TaskRecord> {
    const result = await this.pool.query<TimestampRow>(
      "UPDATE v0_tasks SET branch_name = $2, head_sha = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'RUNNING' RETURNING *",
      [input.taskId, input.branchName, input.headSha],
    );
    if (result.rows[0]) return mapV0Task(result.rows[0]);
    const current = await this.getById(input.taskId);
    if (!current) throw new DatabaseRecordNotFoundError(`V0 task ${input.taskId} was not found.`);
    return current;
  }

  public async requestPrRetry(taskId: string, requestedAt: string): Promise<V0TaskRecord> {
    const result = await this.pool.query<TimestampRow>(
      "UPDATE v0_tasks SET pr_retry_requested = true, updated_at = $2 WHERE id = $1 AND status = 'FAILED' AND error_code = 'GITHUB_PR_CREATE_FAILED' RETURNING *",
      [taskId, requestedAt],
    );
    if (result.rows[0]) return mapV0Task(result.rows[0]);
    const current = await this.getById(taskId);
    if (!current) throw new DatabaseRecordNotFoundError(`V0 task ${taskId} was not found.`);
    return current;
  }

  public async appendLog(input: V0TaskLogInput): Promise<V0TaskLogRecord | null> {
    const message = truncateUtf8(sanitizeV0Log(input.message), 4096);
    if (!message) return null;
    return withTransaction(this.pool, async (client) => {
      const task = await client.query(
        "SELECT id FROM v0_tasks WHERE id = $1 FOR UPDATE",
        [input.taskId],
      );
      if (task.rowCount === 0) {
        throw new DatabaseRecordNotFoundError(`V0 task ${input.taskId} was not found.`);
      }
      const size = await client.query<{ bytes: string }>(
        "SELECT COALESCE(SUM(octet_length(message)), 0)::text AS bytes FROM v0_task_logs WHERE task_id = $1",
        [input.taskId],
      );
      const remaining = 1_048_576 - Number(size.rows[0]?.bytes ?? 0);
      if (remaining <= 0) return null;
      const result = await client.query<TimestampRow>(
        "INSERT INTO v0_task_logs (task_id, occurred_at, stream, message) VALUES ($1, $2, $3, $4) RETURNING *",
        [input.taskId, input.occurredAt, input.stream, truncateUtf8(message, remaining)],
      );
      return mapV0TaskLog(expectOne(result.rows, "Failed to append V0 task log."));
    });
  }

  public async listLogs(taskId: string, limit: number): Promise<readonly V0TaskLogRecord[]> {
    const result = await this.pool.query<TimestampRow>(
      "SELECT * FROM v0_task_logs WHERE task_id = $1 ORDER BY id ASC LIMIT $2",
      [taskId, boundedLimit(limit, 2000)],
    );
    return result.rows.map(mapV0TaskLog);
  }
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maximumBytes) return value;
  return buffer.subarray(0, maximumBytes).toString("utf8").replace(/\uFFFD$/u, "");
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505" &&
    "constraint" in error &&
    (error as { constraint?: unknown }).constraint === constraint
  );
}

function sanitizeV0Log(value: string): string {
  return value
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{10,}/g, "[redacted-token]")
    .replace(/\bsk-[A-Za-z0-9-_]{10,}/g, "[redacted-token]")
    .replace(/\b(?:password|secret|token|authorization)\b\s*[:=]\s*\S+/gi, "[redacted-secret]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-dsn]")
    .replace(/(?:\/(?:home|root|run|etc|var|Users)|[A-Za-z]:\\)[^\s"']*/g, "[redacted-path]")
    .replace(/\s+/g, " ")
    .trim();
}

function isTerminalStatus(status: ExecutionRecord["status"]): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "unknown"
  );
}

class PostgresWorkerWakeupRepository implements WorkerWakeupRepository {
  private static readonly channel = "ade_control_plane_wakeup";

  public constructor(private readonly pool: Pool) {}

  public async signal(input: WorkerWakeup): Promise<void> {
    const payload = JSON.stringify({
      reason: input.reason.slice(0, 100),
      projectId: input.projectId,
      signaledAt: input.signaledAt,
    });
    await this.pool.query("SELECT pg_notify($1, $2)", [PostgresWorkerWakeupRepository.channel, payload]);
  }

  public async listen(handler: (wakeup: WorkerWakeup) => void): Promise<() => Promise<void>> {
    const client = await this.pool.connect();
    await client.query(`LISTEN ${PostgresWorkerWakeupRepository.channel}`);
    const listener = (message: Notification): void => {
      if (!message.payload) return;
      try {
        const parsed = JSON.parse(message.payload) as Record<string, unknown>;
        if (typeof parsed.reason !== "string" || typeof parsed.signaledAt !== "string") return;
        handler({
          reason: parsed.reason.slice(0, 100),
          projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
          signaledAt: parsed.signaledAt,
        });
      } catch {
        // Wakeups are hints; the periodic reconciliation remains authoritative.
      }
    };
    client.on("notification", listener);
    return async () => {
      client.removeListener("notification", listener);
      await client.query(`UNLISTEN ${PostgresWorkerWakeupRepository.channel}`).catch(() => undefined);
      client.release();
    };
  }
}

export class PostgresControlPlaneStore implements ControlPlanePersistence {
  public readonly agentUsage: AgentUsageRepository;
  public readonly v0Tasks: V0TaskRepository;
  public readonly adeDecisions: AdeDecisionRepository;
  public readonly auditEvents: AuditEventRepository;
  public readonly githubBotComments: GithubBotCommentRepository;
  public readonly githubDeliveries: GithubDeliveryRepository;
  public readonly githubWork: GithubWorkRepository;
  public readonly controlCommands: ControlCommandRepository;
  public readonly executionLeases: ExecutionLeaseRepository;
  public readonly executions: ExecutionRepository;
  public readonly projectSnapshots: ProjectSnapshotRepository;
  public readonly projects: ProjectRepository;
  public readonly providerQuotaSnapshots: ProviderQuotaSnapshotRepository;
  public readonly runners: RunnerRepository;
  public readonly settings: ControlPlaneSettingsRepository;
  public readonly wakeups: WorkerWakeupRepository;

  private readonly pool: Pool;

  public constructor(config: PostgresConnectionConfig) {
    this.pool = createPool(config);
    this.settings = new PostgresControlPlaneSettingsRepository(this.pool);
    this.agentUsage = new PostgresAgentUsageRepository(this.pool);
    this.projects = new PostgresProjectRepository(this.pool);
    this.projectSnapshots = new PostgresProjectSnapshotRepository(this.pool);
    this.runners = new PostgresRunnerRepository(this.pool);
    this.executions = new PostgresExecutionRepository(this.pool);
    this.executionLeases = new PostgresExecutionLeaseRepository(this.pool);
    this.providerQuotaSnapshots = new PostgresProviderQuotaSnapshotRepository(
      this.pool,
    );
    this.controlCommands = new PostgresControlCommandRepository(this.pool);
    this.auditEvents = new PostgresAuditEventRepository(this.pool);
    this.githubDeliveries = new PostgresGithubDeliveryRepository(this.pool);
    this.githubWork = new PostgresGithubWorkRepository(this.pool);
    this.githubBotComments = new PostgresGithubBotCommentRepository(this.pool);
    this.adeDecisions = new PostgresAdeDecisionRepository(this.pool);
    this.v0Tasks = new PostgresV0TaskRepository(this.pool);
    this.wakeups = new PostgresWorkerWakeupRepository(this.pool);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async migrate(): Promise<readonly string[]> {
    return runMigrations(this.pool);
  }
}
