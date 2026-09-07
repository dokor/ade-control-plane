import type { OverviewViewModel } from "./readModel.js";

export type GithubIntegrationStatus = "healthy" | "degraded" | "unknown";

export interface GithubIntegrationPresentation {
  status: GithubIntegrationStatus;
  badgeStatus: "healthy" | "blocked" | "unknown";
  badgeLabel: string;
  reason: string;
  lastSuccessfulReconcileAt: string | null;
  needsAttention: boolean;
}

/**
 * Global GitHub integration health deliberately ignores per-project projection
 * freshness. A stale/missing project projection is a project concern; it does
 * not mean the GitHub App or reconciliation path is unavailable.
 */
export function presentGithubIntegration(
  overview: Pick<OverviewViewModel, "workerHealth">,
): GithubIntegrationPresentation {
  const lastSuccessfulReconcileAt = overview.workerHealth.lastGithubReconcileAt;

  if (overview.workerHealth.status === "degraded-github") {
    return {
      status: "degraded",
      badgeStatus: "blocked",
      badgeLabel: "Needs attention",
      reason: "The latest worker cycle failed after the last successful GitHub reconciliation.",
      lastSuccessfulReconcileAt,
      needsAttention: true,
    };
  }

  if (lastSuccessfulReconcileAt) {
    return {
      status: "healthy",
      badgeStatus: "healthy",
      badgeLabel: "Connected",
      reason: "GitHub reconciliation is operating. Project projection freshness is tracked independently.",
      lastSuccessfulReconcileAt,
      needsAttention: false,
    };
  }

  return {
    status: "unknown",
    badgeStatus: "unknown",
    badgeLabel: "Not confirmed",
    reason: "No successful GitHub reconciliation has been observed yet.",
    lastSuccessfulReconcileAt: null,
    needsAttention: false,
  };
}
