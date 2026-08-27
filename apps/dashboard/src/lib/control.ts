import { ControlError } from "./errors.js";
import type { Retryability } from "./retry.js";
import type { DashboardIdentity } from "./session.js";

export type ControlCommandType =
  | "project.pause"
  | "project.resume"
  | "project.reprioritize"
  | "global.pause"
  | "global.resume"
  | "global.safe-mode"
  | "runner.drain"
  | "runner.disable"
  | "runner.enable"
  | "execution.safe-retry"
  | "ade.decide";

export const CONTROL_COMMAND_TYPES: readonly ControlCommandType[] = [
  "project.pause",
  "project.resume",
  "project.reprioritize",
  "global.pause",
  "global.resume",
  "global.safe-mode",
  "runner.drain",
  "runner.disable",
  "runner.enable",
  "execution.safe-retry",
  "ade.decide",
];

/** Commands that require an explicit confirmation and a durable audit record. */
export const SENSITIVE_COMMAND_TYPES: readonly ControlCommandType[] = [
  "global.pause",
  "global.resume",
  "global.safe-mode",
  "runner.disable",
  "runner.enable",
  "execution.safe-retry",
  "ade.decide",
];

export function isControlCommandType(value: unknown): value is ControlCommandType {
  return (
    typeof value === "string" &&
    CONTROL_COMMAND_TYPES.includes(value as ControlCommandType)
  );
}

export function isSensitiveCommand(type: ControlCommandType): boolean {
  return SENSITIVE_COMMAND_TYPES.includes(type);
}

export type ValidatedControlCommand =
  | { type: "project.pause"; projectId: string }
  | { type: "project.resume"; projectId: string }
  | { type: "project.reprioritize"; projectId: string; priority: number }
  | { type: "global.pause" }
  | { type: "global.resume" }
  | { type: "global.safe-mode" }
  | { type: "runner.drain"; runnerId: string }
  | { type: "runner.disable"; runnerId: string }
  | { type: "runner.enable"; runnerId: string }
  | { type: "execution.safe-retry"; executionId: string; retryability: Retryability }
  | {
      type: "ade.decide";
      projectId: string;
      decisionRef: string;
      option: string;
    };

export const MINIMUM_PRIORITY = 0;
export const MAXIMUM_PRIORITY = 100;

/**
 * Read access is separated from mutation in code even though the MVP has a
 * single operator, so future policy does not require rewriting handlers.
 */
export function authorizeRead(
  identity: DashboardIdentity | null | undefined,
): DashboardIdentity {
  if (!identity || !identity.canRead) {
    throw new ControlError("UNAUTHENTICATED", "Authentication is required.");
  }
  return identity;
}

/**
 * Every mutation must present an authenticated identity with mutation rights
 * and a same-origin browser context. No proxy header is trusted here: the
 * session cookie is the only accepted identity carrier.
 */
export function authorizeMutation(
  identity: DashboardIdentity | null | undefined,
  requestOrigin: string | null | undefined,
  expectedOrigin: string,
  commandType: ControlCommandType | string,
): DashboardIdentity {
  if (!identity || !identity.canRead) {
    throw new ControlError("UNAUTHENTICATED", "Authentication is required.");
  }
  if (!identity.canMutate) {
    throw new ControlError(
      "FORBIDDEN",
      `Identity is not allowed to submit ${String(commandType)}.`,
    );
  }
  if (!isSameOrigin(requestOrigin, expectedOrigin)) {
    throw new ControlError(
      "CSRF_REJECTED",
      "The request origin does not match the Dashboard origin.",
    );
  }
  if (!isControlCommandType(commandType)) {
    throw new ControlError("UNKNOWN_COMMAND", "Unknown control command.");
  }
  return identity;
}

function isSameOrigin(
  requestOrigin: string | null | undefined,
  expectedOrigin: string,
): boolean {
  if (!requestOrigin) return false;

  try {
    const request = new URL(requestOrigin);
    const expected = new URL(expectedOrigin);
    return (
      request.protocol === expected.protocol &&
      request.host === expected.host
    );
  } catch {
    return false;
  }
}

/**
 * Validates the command shape and refuses unsafe intents.
 *
 * `retryability` must be resolved by the caller from the persisted execution
 * record, never from client input alone; a client-supplied value can only make
 * the check stricter, never looser.
 */
export function validateCommand(
  type: ControlCommandType | string,
  payload: unknown,
): ValidatedControlCommand {
  if (!isControlCommandType(type)) {
    throw new ControlError("UNKNOWN_COMMAND", "Unknown control command.");
  }

  const record = asRecord(payload);

  switch (type) {
    case "global.pause":
    case "global.resume":
    case "global.safe-mode":
      return { type };
    case "project.pause":
    case "project.resume":
      return { type, projectId: requireId(record, "projectId") };
    case "project.reprioritize":
      return {
        type,
        projectId: requireId(record, "projectId"),
        priority: requirePriority(record.priority),
      };
    case "runner.drain":
    case "runner.disable":
    case "runner.enable":
      return { type, runnerId: requireId(record, "runnerId") };
    case "ade.decide":
      return {
        type,
        projectId: requireId(record, "projectId"),
        decisionRef: requireReference(record.decisionRef, "decisionRef"),
        option: requireReference(record.option, "option"),
      };
    case "execution.safe-retry": {
      const retryability = record.retryability;
      if (retryability !== "safe") {
        throw new ControlError(
          "RETRY_NOT_SAFE",
          retryability === "never"
            ? "This execution is not retryable."
            : "Retry is refused until the execution outcome is reconciled.",
        );
      }
      return {
        type,
        executionId: requireId(record, "executionId"),
        retryability: "safe",
      };
    }
  }
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

function requireId(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new ControlError("INVALID_COMMAND", `Field ${field} must be an identifier.`);
  }
  return value;
}

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Decision references and options are opaque tokens supplied by ADE. They are
 * validated as a closed character set so nothing shell-like or structurally
 * surprising can travel further into the control plane.
 */
function requireReference(value: unknown, field: string): string {
  if (typeof value !== "string" || !REFERENCE.test(value)) {
    throw new ControlError("INVALID_COMMAND", `Field ${field} is not a valid reference.`);
  }
  return value;
}

function requirePriority(value: unknown): number {
  const priority = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(priority) ||
    priority < MINIMUM_PRIORITY ||
    priority > MAXIMUM_PRIORITY
  ) {
    throw new ControlError(
      "INVALID_COMMAND",
      `Priority must be an integer between ${MINIMUM_PRIORITY} and ${MAXIMUM_PRIORITY}.`,
    );
  }
  return priority;
}

export function projectIdOf(command: ValidatedControlCommand): string | null {
  return "projectId" in command ? command.projectId : null;
}
