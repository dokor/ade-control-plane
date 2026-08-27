import {
  MUTATING_COMMANDS,
  type GithubActor,
  type GithubCommandType,
  type GithubRepositoryRef,
  type ParsedGithubCommand,
} from "./domain.js";
import { GithubRejection } from "./errors.js";

export interface AuthorizedProject {
  projectId: string;
  repositoryId: string;
}

export interface GithubAuthorizationPolicy {
  /** GitHub numeric actor IDs allowed to issue commands. Logins are not enough. */
  allowedActorIds: readonly string[];
  /** Actor IDs additionally allowed to run mutating commands. */
  allowedMutatingActorIds?: readonly string[];
  /** Installation IDs the control plane accepts deliveries from, when known. */
  allowedInstallationIds?: readonly string[];
}

/**
 * A valid signature proves the delivery came from GitHub. It says nothing about
 * whether the human behind it may drive the control plane, so repository,
 * installation, actor identity and command class are checked separately.
 */
export function authorizeRepository(
  repository: GithubRepositoryRef,
  projects: readonly AuthorizedProject[],
): AuthorizedProject {
  const mapped = projects.find(({ repositoryId }) => repositoryId === repository.id);
  if (!mapped) {
    // Never trust `owner/name` from the payload: only the numeric ID is durable.
    throw new GithubRejection(
      "UNKNOWN_REPOSITORY",
      "Repository is not mapped to a registered project.",
    );
  }
  return mapped;
}

export function authorizeInstallation(
  installationId: string | null,
  policy: GithubAuthorizationPolicy,
): void {
  const allowed = policy.allowedInstallationIds ?? [];
  if (allowed.length === 0) return;

  if (installationId === null || !allowed.includes(installationId)) {
    throw new GithubRejection(
      "UNAUTHORIZED_ACTOR",
      "Delivery came from an installation that is not allow-listed.",
    );
  }
}

export function authorizeActor(
  actor: GithubActor,
  command: ParsedGithubCommand,
  policy: GithubAuthorizationPolicy,
): void {
  if (actor.bot) {
    // Otherwise the control plane's own bot comment could drive the control plane.
    throw new GithubRejection("UNAUTHORIZED_ACTOR", "Bot accounts cannot issue commands.");
  }
  if (!policy.allowedActorIds.includes(actor.id)) {
    throw new GithubRejection("UNAUTHORIZED_ACTOR", "Actor is not allow-listed.");
  }
  if (!isMutating(command.type)) return;

  const mutators = policy.allowedMutatingActorIds ?? policy.allowedActorIds;
  if (!mutators.includes(actor.id)) {
    throw new GithubRejection(
      "UNAUTHORIZED_ACTOR",
      "Actor is not allowed to run mutating commands.",
    );
  }
}

export function isMutating(type: GithubCommandType): boolean {
  return MUTATING_COMMANDS.includes(type);
}

/** Parses `GITHUB_ALLOWED_ACTOR_IDS` style configuration. */
export function parseActorIdList(value: string | undefined): readonly string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^[0-9]+$/.test(entry));
}
