import type { GithubWorkRepository } from "@ade-control-plane/database";
import { ControlError } from "./errors.js";
import type { DashboardIdentity } from "./session.js";

export const REMOVE_GITHUB_WORK_CONFIRMATION = "Remove this Control Plane work item and its correlated terminal executions, workflows and decisions? The GitHub issue, branches and pull requests will NOT be deleted. It stays hidden until you explicitly select the issue and Run again. Active or unconfirmed executions must be cancelled/reconciled first.";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function removeGithubWork(repository: Pick<GithubWorkRepository, "remove">, identity: DashboardIdentity | null,
  input: { projectId: string; issueNumber: number; workId: unknown; confirmed: unknown }) {
  if (!identity) throw new ControlError("UNAUTHENTICATED", "Sign in to remove work.");
  if (!identity.canMutate) throw new ControlError("FORBIDDEN", "This account cannot remove work.");
  if (!uuid.test(input.projectId) || !Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0 || input.issueNumber > 2147483647
    || typeof input.workId !== "string" || !uuid.test(input.workId) || input.confirmed !== true) {
    throw new ControlError("INVALID_COMMAND", "Confirm removal of a valid, selected work item.");
  }
  const result = await repository.remove({ projectId: input.projectId, issueNumber: input.issueNumber,
    workId: input.workId, actorRef: identity.actorRef, occurredAt: new Date().toISOString() });
  if (result === "not-found") throw new ControlError("NOT_FOUND", "This work item no longer exists.");
  if (result === "active") throw new ControlError("CONFLICT", "Cancel the execution and wait for a confirmed terminal state and released lease before removing it. Unknown outcomes require reconciliation.");
  if (result === "ambiguous") throw new ControlError("CONFLICT", "The selected work changed or shares ambiguous execution/decision references. Refresh and resolve the correlation before removal.");
  return { removed: true, alreadyRemoved: result === "already-removed" };
}
