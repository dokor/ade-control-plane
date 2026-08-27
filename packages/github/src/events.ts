import type {
  GithubActor,
  GithubCommentRef,
  GithubEventName,
  GithubRepositoryRef,
  GithubSubjectRef,
  NormalizedGithubEvent,
} from "./domain.js";
import { GithubRejection } from "./errors.js";

/** Comment bodies longer than this are refused rather than truncated. */
export const MAX_COMMENT_BODY_LENGTH = 65_536;

/**
 * Extracts only the fields needed for routing and authorization.
 *
 * Anything else in the payload is discarded here, so no untrusted GitHub text
 * can leak into scheduling, ADE context or a runner command by accident.
 */
export function normalizeEvent(
  deliveryId: string,
  event: GithubEventName,
  payload: unknown,
): NormalizedGithubEvent {
  const root = asRecord(payload, "Delivery payload must be an object.");
  const action = readString(root.action, "action");
  const repository = readRepository(root.repository);
  const installation = asOptionalRecord(root.installation);

  return {
    deliveryId,
    event,
    action,
    repository,
    actor: readActor(root.sender),
    subject: readSubject(event, root),
    comment: readComment(event, root),
    installationId:
      installation === null ? null : readIdentifier(installation.id, "installation.id"),
  };
}

function readRepository(value: unknown): GithubRepositoryRef {
  const repository = asRecord(value, "Delivery is missing a repository.");
  const owner = asRecord(repository.owner, "Repository is missing an owner.");
  return {
    id: readIdentifier(repository.id, "repository.id"),
    owner: readString(owner.login, "repository.owner.login"),
    name: readString(repository.name, "repository.name"),
  };
}

function readActor(value: unknown): GithubActor {
  const sender = asRecord(value, "Delivery is missing a sender.");
  return {
    id: readIdentifier(sender.id, "sender.id"),
    login: readString(sender.login, "sender.login"),
    bot: sender.type === "Bot",
  };
}

function readSubject(
  event: GithubEventName,
  root: Record<string, unknown>,
): GithubSubjectRef | null {
  if (event === "pull_request") {
    const pullRequest = asRecord(root.pull_request, "Delivery is missing a pull request.");
    return { type: "pull_request", number: readNumber(pullRequest.number, "pull_request.number") };
  }

  const issue = asOptionalRecord(root.issue);
  if (issue === null) return null;

  // GitHub delivers PR comments as `issue_comment` with a `pull_request` marker.
  return {
    type: issue.pull_request === undefined ? "issue" : "pull_request",
    number: readNumber(issue.number, "issue.number"),
  };
}

function readComment(
  event: GithubEventName,
  root: Record<string, unknown>,
): GithubCommentRef | null {
  if (event !== "issue_comment") return null;

  const comment = asRecord(root.comment, "Comment event is missing a comment.");
  const body = readString(comment.body, "comment.body");
  if (body.length > MAX_COMMENT_BODY_LENGTH) {
    throw new GithubRejection("PAYLOAD_TOO_LARGE", "Comment body exceeds the accepted size.");
  }

  return { id: readIdentifier(comment.id, "comment.id"), body };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GithubRejection("MALFORMED_PAYLOAD", message);
  }
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GithubRejection("MALFORMED_PAYLOAD", `Field ${field} is missing.`);
  }
  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new GithubRejection("MALFORMED_PAYLOAD", `Field ${field} is not a positive integer.`);
  }
  return value;
}

/** GitHub IDs are numeric but are kept as strings to avoid precision loss. */
function readIdentifier(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return value;
  }
  throw new GithubRejection("MALFORMED_PAYLOAD", `Field ${field} is not a valid identifier.`);
}
