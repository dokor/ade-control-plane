import type { AdeOperation, AdeRetryClassification } from "./domain.js";

export type AdeClientErrorCode =
  | "ADE_OUTPUT_INVALID"
  | "ADE_PROTOCOL_UNSUPPORTED"
  | "ADE_PROCESS_EXITED"
  | "ADE_PROCESS_OUTPUT_LIMIT"
  | "ADE_PROCESS_SPAWN_FAILED"
  | "ADE_PROCESS_TIMEOUT"
  | "ADE_PROJECT_NOT_CONFIGURED";

export class AdeClientError extends Error {
  public constructor(
    public readonly code: AdeClientErrorCode,
    public readonly retryClassification: AdeRetryClassification,
    message: string,
    public readonly adeExecutionRef?: string,
  ) {
    super(message);
    this.name = "AdeClientError";
  }
}

export function retryClassificationFor(operation: AdeOperation): AdeRetryClassification {
  return operation === "advance" || operation === "apply-decision"
    ? "reconcile-first"
    : "safe";
}
