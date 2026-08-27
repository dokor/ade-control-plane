export type GithubRejectionCode =
  | "PAYLOAD_TOO_LARGE"
  | "MISSING_HEADERS"
  | "INVALID_SIGNATURE"
  | "UNSUPPORTED_EVENT"
  | "MALFORMED_PAYLOAD"
  | "UNKNOWN_REPOSITORY"
  | "UNAUTHORIZED_ACTOR"
  | "NO_COMMAND"
  | "UNKNOWN_COMMAND"
  | "INVALID_ARGUMENT";

/**
 * A refusal raised before any control-plane state is mutated.
 *
 * Every code is stable and safe to log; none of them ever carries payload
 * content, since issue and comment text is untrusted input.
 */
export class GithubRejection extends Error {
  public readonly code: GithubRejectionCode;

  public constructor(code: GithubRejectionCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "GithubRejection";
    this.code = code;
  }
}

export function isGithubRejection(value: unknown): value is GithubRejection {
  return value instanceof GithubRejection;
}
