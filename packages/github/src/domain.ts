export type GithubEventName = "issue_comment" | "issues" | "pull_request";

export interface GithubRepositoryRef {
  /** Numeric repository ID: the only durable identity GitHub guarantees. */
  id: string;
  owner: string;
  name: string;
}

export interface GithubActor {
  id: string;
  login: string;
  /** True for GitHub Apps and bots; never authorized to issue commands. */
  bot: boolean;
}

export type GithubSubjectType = "issue" | "pull_request";

export interface GithubSubjectRef {
  type: GithubSubjectType;
  number: number;
}

export interface GithubCommentRef {
  id: string;
  body: string;
}

/**
 * The only shape the rest of the control plane sees.
 *
 * Parsing stops at the fields required for routing and authorization: no raw
 * payload travels further, and nothing here is ever interpolated into a shell
 * command or an ADE prompt.
 */
export interface NormalizedGithubEvent {
  deliveryId: string;
  event: GithubEventName;
  action: string;
  repository: GithubRepositoryRef;
  actor: GithubActor;
  subject: GithubSubjectRef | null;
  comment: GithubCommentRef | null;
  installationId: string | null;
}

export type GithubCommandType =
  | "status"
  | "pause"
  | "resume"
  | "retry"
  | "priority"
  | "decide";

export type ParsedGithubCommand =
  | { type: "status" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "retry" }
  | { type: "priority"; priority: number }
  | { type: "decide"; decisionRef: string; option: string };

/** Read-only commands are safe for any allow-listed actor. */
export const READ_ONLY_COMMANDS: readonly GithubCommandType[] = ["status"];

/** Commands that change durable control-plane state. */
export const MUTATING_COMMANDS: readonly GithubCommandType[] = [
  "pause",
  "resume",
  "retry",
  "priority",
  "decide",
];
