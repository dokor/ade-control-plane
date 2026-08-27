import { randomUUID } from "node:crypto";

import { ControlError, isControlError, type ControlErrorCode } from "./errors.js";

export interface SanitizedError {
  code: ControlErrorCode;
  summary: string;
  correlationId: string;
}

const MAX_SUMMARY_LENGTH = 240;

/**
 * Patterns that must never reach a browser. Redaction is deliberately blunt:
 * a lost detail is cheaper than a leaked credential or host path.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{10,}/g, "[redacted-token]"],
  [/\bsk-[A-Za-z0-9-_]{10,}/g, "[redacted-token]"],
  [/\b(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}/g, "[redacted-token]"],
  [/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g, "[redacted-env]"],
  [/postgres(?:ql)?:\/\/\S+/gi, "[redacted-dsn]"],
  [/(?:\/(?:home|root|run|etc|var|proc|Users)|[A-Za-z]:\\)[^\s"']*/g, "[redacted-path]"],
  [/\b(?:password|secret|token|authorization)\b\s*[:=]\s*\S+/gi, "[redacted-secret]"],
];

/** Redacts credentials/host details and clamps length for browser display. */
export function sanitizeText(value: string, maximumLength = MAX_SUMMARY_LENGTH): string {
  const redacted = REDACTIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value.replace(/\s+/g, " ").trim(),
  );
  return redacted.length > maximumLength
    ? `${redacted.slice(0, maximumLength - 1)}…`
    : redacted;
}

/**
 * Converts any thrown value into a browser-safe payload.
 * Unexpected errors collapse to INTERNAL so stack traces and driver messages
 * never leave the server; the correlation ID links the UI to server logs.
 */
export function sanitizeError(
  error: unknown,
  correlationId: string = randomUUID(),
): SanitizedError {
  if (isControlError(error)) {
    return { code: error.code, summary: sanitizeText(error.summary), correlationId };
  }

  return {
    code: "INTERNAL",
    summary: "The control plane could not complete this request.",
    correlationId,
  };
}

export function toControlError(error: unknown): ControlError {
  return isControlError(error)
    ? error
    : new ControlError("INTERNAL", "The control plane could not complete this request.");
}
