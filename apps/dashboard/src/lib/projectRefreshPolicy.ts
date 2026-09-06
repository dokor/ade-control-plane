import type { ProjectSetupReadiness } from "./projectSetup.js";
import type { OverviewWorkItem, ProjectView } from "./readModel.js";

/**
 * Project-page refresh policy.
 *
 * A refresh reruns the server read model and the read-only ADE/GitHub setup
 * inspection. It does not synchronize GitHub work, write the database, or
 * append a business event; those effects belong to worker and mutation paths.
 */
export const PROJECT_REFRESH_INTERVALS_MS = {
  active: 15_000,
  retry: 60_000,
  stable: 300_000,
} as const;

export type ProjectRefreshMode = keyof typeof PROJECT_REFRESH_INTERVALS_MS;

export interface ProjectRefreshPolicy {
  mode: ProjectRefreshMode;
  intervalMs: number;
}

export function projectRefreshPolicy(
  project: ProjectView,
  readiness: ProjectSetupReadiness,
  work: readonly OverviewWorkItem[],
): ProjectRefreshPolicy {
  const transitionExpected = Boolean(readiness.setupPullRequestUrl)
    || readiness.capabilitySnapshot?.status === "stale"
    || project.adeStatus === "validating";
  const active = transitionExpected
    || work.some((item) => item.active || item.status === "reconciling")
    || project.status === "running"
    || project.status === "reconciling";

  if (active) return policy("active");
  // A failed inspection is operational noise, not a new business transition.
  // Back off instead of turning a temporary GitHub failure into a tight loop.
  if (readiness.inspectionFailed || readiness.setupPullRequestLookupFailed) return policy("retry");
  return policy("stable");
}

function policy(mode: ProjectRefreshMode): ProjectRefreshPolicy {
  return { mode, intervalMs: PROJECT_REFRESH_INTERVALS_MS[mode] };
}
