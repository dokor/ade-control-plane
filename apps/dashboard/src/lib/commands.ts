import type {
  ControlCommandRecord,
  ControlCommandSource,
  ControlPlanePersistence,
  JsonValue,
} from "@ade-control-plane/database";

import {
  authorizeMutation,
  isSensitiveCommand,
  projectIdOf,
  type ControlCommandType,
  type ValidatedControlCommand,
  validateCommand,
} from "./control.js";
import { ControlError, isControlError } from "./errors.js";
import { classifyRetryability } from "./retry.js";
import { sanitizeText } from "./sanitize.js";
import type { DashboardIdentity } from "./session.js";

export interface ControlCommandRequest {
  type: string;
  payload: unknown;
  idempotencyKey?: string | null;
}

/**
 * Who is submitting, once authorization has already succeeded.
 *
 * Each entry point owns its own authentication proof — a session cookie plus a
 * same-origin check for the Dashboard, a webhook signature plus an actor
 * allow-list for GitHub — and only then describes the submitter here.
 */
export interface CommandSubmitter {
  source: ControlCommandSource;
  actorType: string;
  actorRef: string;
}

export interface ControlCommandContext {
  persistence: ControlPlanePersistence;
  submitter: CommandSubmitter;
  now: string;
  correlationId: string;
}

export interface ControlCommandOutcome {
  commandId: string;
  status: "applied";
  summary: string;
}

export interface DashboardCommandContext {
  persistence: ControlPlanePersistence;
  identity: DashboardIdentity | null;
  requestOrigin: string | null;
  expectedOrigin: string;
  now: string;
  correlationId: string;
}

/**
 * Dashboard entry point: authenticates and checks the origin, then hands over
 * to the shared pipeline.
 */
export async function submitDashboardCommand(
  context: DashboardCommandContext,
  request: ControlCommandRequest,
): Promise<ControlCommandOutcome> {
  let identity: DashboardIdentity;
  try {
    identity = authorizeMutation(
      context.identity,
      context.requestOrigin,
      context.expectedOrigin,
      request.type,
    );
  } catch (error) {
    // Rejections before authentication never create a control_commands row:
    // an unauthenticated caller must not be able to grow that table.
    await appendSecurityAudit(
      context.persistence,
      {
        occurredAt: context.now,
        actorType: context.identity ? "operator" : "anonymous",
        actorRef: context.identity?.actorRef ?? null,
        correlationId: context.correlationId,
        commandType: request.type,
      },
      error,
    );
    throw error;
  }

  return submitControlCommand(
    {
      persistence: context.persistence,
      submitter: {
        source: "dashboard",
        actorType: "operator",
        actorRef: identity.actorRef,
      },
      now: context.now,
      correlationId: context.correlationId,
    },
    request,
  );
}

/**
 * The single write path into control plane state, shared by every entry point.
 *
 * Ordering is deliberate and must not be relaxed:
 * validate → persist `ControlCommand` + audit identity → apply the durable
 * state mutation → mark the command applied.
 *
 * No branch of this function executes runner work; privileged execution is
 * always started later by the worker from durable state.
 */
export async function submitControlCommand(
  context: ControlCommandContext,
  request: ControlCommandRequest,
): Promise<ControlCommandOutcome> {
  const command = await validateOrReject(context, request);
  const receipt = await context.persistence.controlCommands.recordReceipt({
    source: context.submitter.source,
    actorType: context.submitter.actorType,
    actorRef: context.submitter.actorRef,
    projectId: projectIdOf(command),
    commandType: command.type,
    payload: toPayload(command),
    idempotencyKey: request.idempotencyKey ?? null,
    receivedAt: context.now,
  });

  if (receipt.status === "applied") {
    return {
      commandId: receipt.id,
      status: "applied",
      summary: "Command was already applied.",
    };
  }

  await appendCommandAudit(context, command, receipt, "authorized");
  await context.persistence.controlCommands.updateStatus(receipt.id, {
    status: "authorized",
  });

  try {
    const summary = await applyCommand(context, command);
    await context.persistence.controlCommands.updateStatus(receipt.id, {
      status: "applied",
      appliedAt: context.now,
      resultSummary: { summary },
    });
    await appendCommandAudit(context, command, receipt, "applied");
    return { commandId: receipt.id, status: "applied", summary };
  } catch (error) {
    await context.persistence.controlCommands.updateStatus(receipt.id, {
      status: "failed",
      resultSummary: { summary: sanitizeText(describe(error)) },
    });
    await appendCommandAudit(context, command, receipt, "failed");
    throw error;
  }
}

async function validateOrReject(
  context: ControlCommandContext,
  request: ControlCommandRequest,
): Promise<ValidatedControlCommand> {
  try {
    return validateCommand(request.type, await resolvePayload(context, request));
  } catch (error) {
    const rejected = await context.persistence.controlCommands.recordReceipt({
      source: context.submitter.source,
      actorType: context.submitter.actorType,
      actorRef: context.submitter.actorRef,
      projectId: null,
      commandType: sanitizeText(String(request.type)),
      payload: null,
      idempotencyKey: request.idempotencyKey ?? null,
      receivedAt: context.now,
    });
    await context.persistence.controlCommands.updateStatus(rejected.id, {
      status: "rejected",
      resultSummary: { summary: sanitizeText(describe(error)) },
    });
    await context.persistence.auditEvents.append({
      occurredAt: context.now,
      category: "control",
      severity: "warning",
      actorType: context.submitter.actorType,
      actorRef: context.submitter.actorRef,
      action: "command.rejected",
      reason: sanitizeText(describe(error)),
      result: "rejected",
      correlationId: context.correlationId,
      metadata: { commandType: sanitizeText(String(request.type)) },
    });
    throw error;
  }
}

/**
 * Recomputes the facts a caller must never be trusted to assert.
 *
 * Retryability comes from the persisted execution record, and a decision option
 * must be one ADE actually exposed, so neither a crafted HTTP body nor a GitHub
 * comment can widen what a command is allowed to do.
 */
async function resolvePayload(
  context: ControlCommandContext,
  request: ControlCommandRequest,
): Promise<unknown> {
  const payload =
    typeof request.payload === "object" && request.payload !== null
      ? (request.payload as Record<string, unknown>)
      : {};

  if (request.type === "execution.safe-retry") {
    const executionId = payload.executionId;
    if (typeof executionId !== "string") return { ...payload, retryability: "never" };

    const execution = await context.persistence.executions.getById(executionId);
    if (!execution) {
      throw new ControlError("NOT_FOUND", "Execution is unknown to the control plane.");
    }
    return { ...payload, retryability: classifyRetryability(execution) };
  }

  if (request.type === "ade.decide") {
    const { projectId, decisionRef, option } = payload;
    if (
      typeof projectId !== "string" ||
      typeof decisionRef !== "string" ||
      typeof option !== "string"
    ) {
      return payload;
    }

    const decision = await context.persistence.adeDecisions.getByRef(
      projectId,
      decisionRef,
    );
    if (!decision) {
      throw new ControlError("NOT_FOUND", "This decision is not exposed by ADE.");
    }
    if (!decision.options.includes(option)) {
      throw new ControlError(
        "INVALID_COMMAND",
        "The option is not one ADE offered for this decision.",
      );
    }
    return payload;
  }

  return request.payload;
}

async function applyCommand(
  context: ControlCommandContext,
  command: ValidatedControlCommand,
): Promise<string> {
  const { persistence } = context;

  switch (command.type) {
    case "project.pause":
      await persistence.projects.updateState(command.projectId, "paused");
      return "Project paused; the scheduler stops selecting it on the next cycle.";
    case "project.resume":
      await persistence.projects.updateState(command.projectId, "enabled");
      return "Project resumed; eligibility is re-evaluated on the next scheduler cycle.";
    case "project.reprioritize":
      await persistence.projects.updatePriority(command.projectId, command.priority);
      return `Project priority set to ${command.priority}.`;
    case "global.pause":
      await updateMode(context, "paused");
      return "Global scheduling paused; no new privileged dispatch will start.";
    case "global.resume":
      await updateMode(context, "running");
      return "Global scheduling resumed.";
    case "global.safe-mode":
      await updateMode(context, "safe_mode");
      return "Safe mode enabled; only reconciliation continues.";
    case "runner.drain":
      await persistence.runners.updateState(command.runnerId, "draining");
      return "Runner is draining; running work finishes and no new work is dispatched.";
    case "runner.disable":
      await persistence.runners.updateState(command.runnerId, "disabled");
      return "Runner disabled.";
    case "runner.enable":
      await persistence.runners.updateState(command.runnerId, "online");
      return "Runner re-enabled.";
    case "execution.safe-retry":
      // Durable intent only. The worker owns dispatch; no entry point does.
      return "Safe retry queued; the worker will pick it up on its next cycle.";
    case "ade.decide": {
      const resolved = await persistence.adeDecisions.resolve(
        command.projectId,
        command.decisionRef,
        command.option,
        context.submitter.actorRef,
        context.now,
      );
      if (resolved) {
        await persistence.wakeups?.signal({
          reason: "ade-decision-resolved",
          projectId: command.projectId,
          signaledAt: context.now,
        });
      }
      // A replayed resolution finds no open decision and stays a no-op.
      return resolved
        ? `Decision ${command.decisionRef} resolved as ${command.option}; the worker will forward it to ADE.`
        : `Decision ${command.decisionRef} was already resolved.`;
    }
  }
}

async function updateMode(
  context: ControlCommandContext,
  schedulerMode: "running" | "paused" | "safe_mode",
): Promise<void> {
  await context.persistence.settings.update({
    schedulerMode,
    updatedAt: context.now,
    updatedBy: context.submitter.actorRef,
  });
}

async function appendCommandAudit(
  context: ControlCommandContext,
  command: ValidatedControlCommand,
  receipt: ControlCommandRecord,
  result: "authorized" | "applied" | "failed",
): Promise<void> {
  await context.persistence.auditEvents.append({
    occurredAt: context.now,
    category: "control",
    severity: result === "failed" ? "error" : "info",
    actorType: context.submitter.actorType,
    actorRef: context.submitter.actorRef,
    projectId: projectIdOf(command),
    runnerId: "runnerId" in command ? command.runnerId : null,
    executionId: "executionId" in command ? command.executionId : null,
    action: `command.${result}`,
    result,
    correlationId: context.correlationId,
    metadata: {
      commandId: receipt.id,
      commandType: command.type,
      source: context.submitter.source,
      sensitive: isSensitiveCommand(command.type as ControlCommandType),
    },
  });
}

export interface SecurityAuditInput {
  occurredAt: string;
  actorType: string;
  actorRef: string | null;
  correlationId: string;
  commandType: string;
  projectId?: string | null;
}

/** Records a denied attempt without creating any control command state. */
export async function appendSecurityAudit(
  persistence: ControlPlanePersistence,
  input: SecurityAuditInput,
  error: unknown,
): Promise<void> {
  await persistence.auditEvents.append({
    occurredAt: input.occurredAt,
    category: "security",
    severity: "warning",
    actorType: input.actorType,
    actorRef: input.actorRef,
    projectId: input.projectId ?? null,
    action: "command.denied",
    reason: reasonCode(error),
    result: "denied",
    correlationId: input.correlationId,
    metadata: { commandType: sanitizeText(String(input.commandType)) },
  });
}

function reasonCode(error: unknown): string {
  if (isControlError(error)) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "INTERNAL";
}

function toPayload(command: ValidatedControlCommand): JsonValue {
  return { ...command } as JsonValue;
}

function describe(error: unknown): string {
  return isControlError(error) ? `${error.code}: ${error.summary}` : "INTERNAL";
}
