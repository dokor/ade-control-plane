/**
 * Stable, user-facing control error codes.
 *
 * The Dashboard never renders raw exception messages: every failure surfaces as
 * one of these codes plus a sanitized summary and a correlation ID.
 */
export type ControlErrorCode =
  | "UNAUTHENTICATED"
  | "CSRF_REJECTED"
  | "FORBIDDEN"
  | "UNKNOWN_COMMAND"
  | "INVALID_COMMAND"
  | "RETRY_NOT_SAFE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

const HTTP_STATUS: Readonly<Record<ControlErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  CSRF_REJECTED: 403,
  FORBIDDEN: 403,
  UNKNOWN_COMMAND: 400,
  INVALID_COMMAND: 400,
  RETRY_NOT_SAFE: 409,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class ControlError extends Error {
  public readonly code: ControlErrorCode;
  public readonly summary: string;

  public constructor(code: ControlErrorCode, summary: string) {
    super(`${code}: ${summary}`);
    this.name = "ControlError";
    this.code = code;
    this.summary = summary;
  }

  public get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function isControlError(value: unknown): value is ControlError {
  return value instanceof ControlError;
}

export function httpStatusForCode(code: ControlErrorCode): number {
  return HTTP_STATUS[code];
}
