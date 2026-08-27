import type {
  ControlCommandRecord,
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

export interface ControlCommandContext {
  persistence: ControlPlanePersistence;
  identity: DashboardIdentity | null;
  requestOrigin: string | null;
  expectedOrigin: string;
  now: string;
  correlationId: string;
}

export interface ControlCommandOutcome {
  commandId: string;
  status: "applied";
  summary: string;
}

/**
 * The single write path from the browser into control plane state.
 *
 * Ordering is deliberate and must not be relaxed:
 * authorize → validate → persist `ControlCommand` + audit identity →
 * apply the durable state mutation → mark the command applied.
 *
 * No branch of this function executes runner work; privileged execution is
 * always started later by the worker from durable state.
 */
export async function submitControlCommand(
  context: ControlCommandContext,
  request: ControlCommandRequest,
): Promise<ControlCommandOutcome> {
  const identity = await authorizeOrAudit(context, request);
  const command = await validateOrReject(context, identity, request);
  const receipt = await context.persistence.controlCommands.recordReceipt({
    source: "dashboard",
    actorType: "operator",
    actorRef: identity.actorRef,
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

  await appendCommandAudit(context, identity, command, receipt, "authorized");
  await context.persistence.controlCommands.updateStatus(receipt.id, {
    status: "authorized",
  });

  try {
    const summary = await applyCommand(context.persistence, command, context);
    await context.persistence.controlCommands.updateStatus(receipt.id, {
      status: "applied",
      appliedAt: context.now,
      resultSummary: { summary },
    });
    await appendCommandAudit(context, identity, command, receipt, "applied");
    return { commandId: receipt.id, status: "applied", summary };
  } catch (error) {
    await context.persistence.controlCommands.updateStatus(receipt.id, {
      status: "failed",
      resultSummary: { summary: sanitizeText(describe(error)) },
    });
    await appendCommandAudit(context, identity, command, receipt, "failed");
    throw error;
  }
}

async function authorizeOrAudit(
  context: ControlCommandContext,
  request: ControlCommandRequest,
): Promise<DashboardIdentity> {
  try {
    return authorizeMutation(
      context.identity,
      context.requestOrigin,
      context.expectedOrigin,
      request.type,
    );
  } catch (error) {
    // Rejections before authentication never create a control_commands row:
    // an unauthenticated caller must not be able to grow that table.
    await appendSecurityAudit(context, request, error);
    throw error;
  }
}

async function validateOrReject(
  context: ControlCommandContext,
  identity: DashboardIdentity,
  request: ControlCommandRequest,
): Promise<ValidatedControlCommand> {
  try {
    return validateCommand(request.type, await resolvePayload(context, request));
  } catch (error) {
    const rejected = await context.persistence.controlCommands.recordReceipt({
      source: "dashboard",
      actorType: "operator",
      actorRef: identity.actorRef,
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
      actorType: "operator",
      actorRef: identity.actorRef,
      action: `command.rejected`,
      reason: sanitizeText(describe(error)),
      result: "rejected",
      correlationId: context.correlationId,
      metadata: { commandType: sanitizeText(String(request.type)) },
    });
    throw error;
  }
}

/**
 * Retryability is recomputed from the persisted execution record so a crafted
 * request body can never declare its own retry as safe.
 */
async function resolvePayload(
  context: ControlCommandContext,
  request: ControlCommandRequest,
): Promise<unknown> {
  if (request.type !== "execution.safe-retry") return request.payload;

  const payload =
    typeof request.payload === "object" && request.payload !== null
      ? (request.payload as Record<string, unknown>)
      : {};
  const executionId = payload.executionId;
  if (typeof executionId !== "string") return { ...payload, retryability: "never" };

  const execution = await context.persistence.executions.getById(executionId);
  if (!execution) {
    throw new ControlError("NOT_FOUND", "Execution is unknown to the control plane.");
  }
  return { ...payload, retryability: classifyRetryability(execution) };
}

async function applyCommand(
  persistence: ControlPlanePersistence,
  command: ValidatedControlCommand,
  context: ControlCommandContext,
): Promise<string> {
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
      await updateMode(persistence, "paused", context);
      return "Global scheduling paused; no new privileged dispatch will start.";
    case "global.resume":
      await updateMode(persistence, "running", context);
      return "Global scheduling resumed.";
    case "global.safe-mode":
      await updateMode(persistence, "safe_mode", context);
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
      // Durable intent only. The worker owns dispatch; the Dashboard never does.
      return "Safe retry queued; the worker will pick it up on its next cycle.";
  }
}

async function updateMode(
  persistence: ControlPlanePersistence,
  schedulerMode: "running" | "paused" | "safe_mode",
  context: ControlCommandContext,
): Promise<void> {
  await persistence.settings.update({
    schedulerMode,
    updatedAt: context.now,
    updatedBy: context.identity?.actorRef ?? "unknown",
  });
}

async function appendCommandAudit(
  context: ControlCommandContext,
  identity: DashboardIdentity,
  command: ValidatedControlCommand,
  receipt: ControlCommandRecord,
  result: "authorized" | "applied" | "failed",
): Promise<void> {
  await context.persistence.auditEvents.append({
    occurredAt: context.now,
    category: "control",
    severity: result === "failed" ? "error" : "info",
    actorType: "operator",
    actorRef: identity.actorRef,
    projectId: projectIdOf(command),
    runnerId: "runnerId" in command ? command.runnerId : null,
    executionId: "executionId" in command ? command.executionId : null,
    action: `command.${result}`,
    result,
    correlationId: context.correlationId,
    metadata: {
      commandId: receipt.id,
      commandType: command.type,
      sensitive: isSensitiveCommand(command.type as ControlCommandType),
    },
  });
}

async function appendSecurityAudit(
  context: ControlCommandContext,
  request: ControlCommandRequest,
  error: unknown,
): Promise<void> {
  await context.persistence.auditEvents.append({
    occurredAt: context.now,
    category: "security",
    severity: "warning",
    actorType: context.identity ? "operator" : "anonymous",
    actorRef: context.identity?.actorRef ?? null,
    action: "command.denied",
    reason: isControlError(error) ? error.code : "INTERNAL",
    result: "denied",
    correlationId: context.correlationId,
    metadata: { commandType: sanitizeText(String(request.type)) },
  });
}

function toPayload(command: ValidatedControlCommand): JsonValue {
  return { ...command } as JsonValue;
}

function describe(error: unknown): string {
  return isControlError(error) ? `${error.code}: ${error.summary}` : "INTERNAL";
}
