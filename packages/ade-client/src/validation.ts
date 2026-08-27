import {
  ADE_PROTOCOL_VERSION,
  type AdeAdvanceResult,
  type AdeCapabilities,
  type AdeExecutionReconciliation,
  type AdeHumanDecisionRequest,
  type AdeHumanDecisionResult,
  type AdeOperation,
  type AdeProjectState,
  type AdeProjectStatus,
  type AdeRunnableWork,
  type AdeWorkSummary,
} from "./domain.js";
import { AdeClientError } from "./errors.js";

type RecordValue = Record<string, unknown>;

const operations = new Set<AdeOperation>([
  "capabilities",
  "status",
  "runnable-work",
  "advance",
  "apply-decision",
  "reconcile",
]);
const projectStates = new Set<AdeProjectState>([
  "unknown",
  "ready",
  "running",
  "waiting-human",
  "blocked",
  "failed",
  "completed",
]);

function invalid(message: string): never {
  throw new AdeClientError("ADE_OUTPUT_INVALID", "safe", message);
}

function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${path} must be an object.`);
  }
  return value as RecordValue;
}

function exactKeys(value: RecordValue, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      invalid(`${path}.${key} is not supported.`);
    }
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    return invalid(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path);
}

function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (Number.isNaN(Date.parse(parsed))) {
    return invalid(`${path} must be an ISO timestamp.`);
  }
  return parsed;
}

function optionalTimestamp(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, path);
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return invalid(`${path} must be an array of strings.`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
  return value === undefined ? undefined : stringArray(value, path);
}

function parseWorkSummary(value: unknown, path: string): AdeWorkSummary {
  const parsed = record(value, path);
  exactKeys(parsed, ["ref", "summary"], path);
  return { ref: string(parsed.ref, `${path}.ref`), summary: string(parsed.summary, `${path}.summary`) };
}

function optionalWorkSummary(value: unknown, path: string): AdeWorkSummary | undefined {
  return value === undefined ? undefined : parseWorkSummary(value, path);
}

function parseCapabilities(value: unknown, path: string): AdeCapabilities {
  const parsed = record(value, path);
  exactKeys(parsed, ["protocolVersion", "adeVersion", "operations", "observedAt"], path);
  if (parsed.protocolVersion !== ADE_PROTOCOL_VERSION) {
    throw new AdeClientError(
      "ADE_PROTOCOL_UNSUPPORTED",
      "never",
      `ADE protocol version must be ${ADE_PROTOCOL_VERSION}.`,
    );
  }
  const declaredOperations = stringArray(parsed.operations, `${path}.operations`);
  if (declaredOperations.some((operation) => !operations.has(operation as AdeOperation))) {
    return invalid(`${path}.operations contains an unsupported operation.`);
  }
  return {
    protocolVersion: ADE_PROTOCOL_VERSION,
    adeVersion: string(parsed.adeVersion, `${path}.adeVersion`),
    operations: declaredOperations as readonly AdeOperation[],
    observedAt: timestamp(parsed.observedAt, `${path}.observedAt`),
  };
}

function parseHumanDecision(value: unknown, path: string): AdeHumanDecisionRequest {
  const parsed = record(value, path);
  exactKeys(parsed, ["reference", "options", "summary"], path);
  if (!Array.isArray(parsed.options)) {
    return invalid(`${path}.options must be an array.`);
  }
  const summary = optionalString(parsed.summary, `${path}.summary`);
  return {
    reference: string(parsed.reference, `${path}.reference`),
    options: parsed.options.map((option, index) => {
      const item = record(option, `${path}.options[${index}]`);
      exactKeys(item, ["label", "value"], `${path}.options[${index}]`);
      return {
        label: string(item.label, `${path}.options[${index}].label`),
        value: string(item.value, `${path}.options[${index}].value`),
      };
    }),
    ...(summary ? { summary } : {}),
  };
}

function optionalHumanDecision(value: unknown, path: string): AdeHumanDecisionRequest | undefined {
  return value === undefined ? undefined : parseHumanDecision(value, path);
}

export function parseEnvelope(value: unknown, operation: AdeOperation): unknown {
  const parsed = record(value, "response");
  exactKeys(parsed, ["protocolVersion", "operation", "value"], "response");
  if (parsed.protocolVersion !== ADE_PROTOCOL_VERSION) {
    throw new AdeClientError("ADE_PROTOCOL_UNSUPPORTED", "never", "ADE returned an unsupported protocol version.");
  }
  if (parsed.operation !== operation) {
    return invalid(`response.operation must be ${operation}.`);
  }
  return parsed.value;
}

export function parseAdeCapabilities(value: unknown): AdeCapabilities {
  return parseCapabilities(value, "response.value");
}

export function parseAdeProjectStatus(value: unknown): AdeProjectStatus {
  const parsed = record(value, "response.value");
  exactKeys(parsed, ["projectId", "state", "adeRunRef", "stage", "milestone", "currentWork", "nextWork", "waitingReason", "humanDecision", "observedAt", "expiresAt", "capabilities"], "response.value");
  if (typeof parsed.state !== "string" || !projectStates.has(parsed.state as AdeProjectState)) {
    return invalid("response.value.state is not a supported ADE project state.");
  }
  const adeRunRef = optionalString(parsed.adeRunRef, "response.value.adeRunRef");
  const stage = optionalString(parsed.stage, "response.value.stage");
  const milestone = optionalString(parsed.milestone, "response.value.milestone");
  const currentWork = optionalWorkSummary(parsed.currentWork, "response.value.currentWork");
  const nextWork = optionalWorkSummary(parsed.nextWork, "response.value.nextWork");
  const waitingReason = optionalString(parsed.waitingReason, "response.value.waitingReason");
  const humanDecision = optionalHumanDecision(parsed.humanDecision, "response.value.humanDecision");
  const expiresAt = optionalTimestamp(parsed.expiresAt, "response.value.expiresAt");
  return {
    projectId: string(parsed.projectId, "response.value.projectId"),
    state: parsed.state as AdeProjectState,
    ...(adeRunRef ? { adeRunRef } : {}),
    ...(stage ? { stage } : {}),
    ...(milestone ? { milestone } : {}),
    ...(currentWork ? { currentWork } : {}),
    ...(nextWork ? { nextWork } : {}),
    ...(waitingReason ? { waitingReason } : {}),
    ...(humanDecision ? { humanDecision } : {}),
    observedAt: timestamp(parsed.observedAt, "response.value.observedAt"),
    ...(expiresAt ? { expiresAt } : {}),
    capabilities: parseCapabilities(parsed.capabilities, "response.value.capabilities"),
  };
}

export function parseAdeRunnableWork(value: unknown): AdeRunnableWork | null {
  if (value === null) return null;
  const parsed = record(value, "response.value");
  exactKeys(parsed, ["ref", "summary", "estimatedClass", "requiredRunnerLabels"], "response.value");
  if (parsed.estimatedClass !== undefined && !["short", "normal", "long"].includes(String(parsed.estimatedClass))) {
    return invalid("response.value.estimatedClass is not supported.");
  }
  const estimatedClass = parsed.estimatedClass as AdeRunnableWork["estimatedClass"];
  const requiredRunnerLabels = optionalStringArray(parsed.requiredRunnerLabels, "response.value.requiredRunnerLabels");
  return {
    ref: string(parsed.ref, "response.value.ref"),
    summary: string(parsed.summary, "response.value.summary"),
    ...(estimatedClass ? { estimatedClass } : {}),
    ...(requiredRunnerLabels ? { requiredRunnerLabels } : {}),
  };
}

export function parseAdeAdvanceResult(value: unknown): AdeAdvanceResult {
  const parsed = record(value, "response.value");
  exactKeys(parsed, ["adeExecutionRef", "controlPlaneExecutionId", "state", "summary", "nextAction", "references"], "response.value");
  const states = new Set(["accepted", "running", "succeeded", "waiting-human", "blocked", "failed", "unknown"]);
  if (typeof parsed.state !== "string" || !states.has(parsed.state)) return invalid("response.value.state is not supported.");
  const adeExecutionRef = optionalString(parsed.adeExecutionRef, "response.value.adeExecutionRef");
  const nextAction = optionalString(parsed.nextAction, "response.value.nextAction");
  const references = optionalStringArray(parsed.references, "response.value.references");
  return {
    ...(adeExecutionRef ? { adeExecutionRef } : {}),
    controlPlaneExecutionId: string(parsed.controlPlaneExecutionId, "response.value.controlPlaneExecutionId"),
    state: parsed.state as AdeAdvanceResult["state"],
    summary: string(parsed.summary, "response.value.summary"),
    ...(nextAction ? { nextAction } : {}),
    ...(references ? { references } : {}),
  };
}

export function parseAdeHumanDecisionResult(value: unknown): AdeHumanDecisionResult {
  const parsed = record(value, "response.value");
  exactKeys(parsed, ["decisionRef", "state", "summary"], "response.value");
  if (parsed.state !== "applied" && parsed.state !== "rejected") return invalid("response.value.state is not supported.");
  const summary = optionalString(parsed.summary, "response.value.summary");
  return { decisionRef: string(parsed.decisionRef, "response.value.decisionRef"), state: parsed.state, ...(summary ? { summary } : {}) };
}

export function parseAdeExecutionReconciliation(value: unknown): AdeExecutionReconciliation {
  const parsed = record(value, "response.value");
  exactKeys(parsed, ["adeExecutionRef", "controlPlaneExecutionId", "state", "summary"], "response.value");
  const states = new Set(["running", "succeeded", "failed", "cancelled", "unknown", "not-found"]);
  if (typeof parsed.state !== "string" || !states.has(parsed.state)) return invalid("response.value.state is not supported.");
  const adeExecutionRef = optionalString(parsed.adeExecutionRef, "response.value.adeExecutionRef");
  const summary = optionalString(parsed.summary, "response.value.summary");
  return {
    ...(adeExecutionRef ? { adeExecutionRef } : {}),
    controlPlaneExecutionId: string(parsed.controlPlaneExecutionId, "response.value.controlPlaneExecutionId"),
    state: parsed.state as AdeExecutionReconciliation["state"],
    ...(summary ? { summary } : {}),
  };
}
