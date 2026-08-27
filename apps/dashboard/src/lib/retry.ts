import type { ExecutionRecord } from "@ade-control-plane/database";

/**
 * `safe` — the control plane knows the attempt never reached privileged work.
 * `reconcile-first` — the outcome is ambiguous; ADE/runner state must be read back.
 * `never` — retrying is meaningless or unsafe (already finished, security block).
 */
export type Retryability = "safe" | "reconcile-first" | "never";

/**
 * Error codes that prove the failure happened before or outside privileged
 * execution. Anything not on this list stays ambiguous by default: a stale or
 * unrecognised failure is never treated as a safe retry.
 */
const SAFE_ERROR_CODES: ReadonlySet<string> = new Set([
  "RUNNER_UNAVAILABLE",
  "RUNNER_REJECTED",
  "NO_COMPATIBLE_RUNNER",
  "QUOTA_BLOCKED",
  "LEASE_CONFLICT",
  "DISPATCH_REFUSED",
]);

const NEVER_ERROR_CODE_PREFIXES: readonly string[] = ["SECURITY_", "AUTHORIZATION_"];

export function classifyRetryability(execution: ExecutionRecord): Retryability {
  if (execution.status === "succeeded") return "never";
  if (execution.status === "unknown") return "reconcile-first";
  if (execution.status !== "failed" && execution.status !== "cancelled") {
    return "reconcile-first";
  }

  const errorCode = execution.errorCode;
  if (errorCode === null) return "reconcile-first";
  if (NEVER_ERROR_CODE_PREFIXES.some((prefix) => errorCode.startsWith(prefix))) {
    return "never";
  }
  return SAFE_ERROR_CODES.has(errorCode) ? "safe" : "reconcile-first";
}

export function retryabilityExplanation(retryability: Retryability): string {
  if (retryability === "safe") {
    return "The attempt failed before privileged work started, so a retry cannot duplicate side effects.";
  }
  if (retryability === "never") {
    return "This execution must not be retried from the Dashboard.";
  }
  return "The outcome is ambiguous: the control plane must reconcile ADE and runner state before any retry.";
}
