import type { OverviewProjectReadinessPresentation } from "./overviewReadiness.js";
import type { OverviewViewModel } from "./readModel.js";

export function summarizeOverview(
  overview: OverviewViewModel,
  readinessPresentation: readonly OverviewProjectReadinessPresentation[] = [],
) {
  const { projects, unavailableSections } = overview;
  const readinessAvailable = !unavailableSections.includes("Project readiness");
  const presentationByProject = new Map(readinessPresentation.map((item) => [item.id, item]));
  const readiness = projects.map((project, index) => {
    const fallbackReadiness = project.controlState === "disabled" ? "disabled"
      : !readinessAvailable ? "unknown"
      : project.adeStatus === "compatible" ? "ready"
      : project.adeStatus === "setup-required" || project.adeStatus === "validating" ? "setup-required" : "incompatible";
    const presentation = presentationByProject.get(project.id);
    return {
      ...project,
      readiness: presentation ? (presentation.ready ? "ready" : presentation.status) : fallbackReadiness,
      badgeStatus: presentation?.status ?? fallbackReadiness,
      badgeLabel: presentation?.label ?? fallbackReadiness,
      progress: presentation?.progress ?? fallbackProgress(fallbackReadiness),
      originalIndex: index,
    };
  }).sort((left, right) => right.progress - left.progress || left.originalIndex - right.originalIndex);
  const alerts: { id: string; title: string; reason: string; href: string; action: string; status: string }[] = [];
  for (const work of overview.work.filter((item) => item.needsAttention)) {
    alerts.push({ id: work.id, title: `${work.projectName} · ${work.title}`, reason: work.reason,
      status: work.status, href: work.href, action: "Review work" });
  }
  for (const project of readiness) {
    if (["setup-required", "incompatible", "blocked"].includes(project.badgeStatus)) {
      alerts.push({ id: `setup:${project.id}`, title: `${project.name} needs ADE preparation`,
        reason: project.badgeStatus === "incompatible" ? "ADE readiness failed. Review the compatibility checks."
          : project.badgeStatus === "blocked" ? "ADE preparation is blocked. Review the required project checks."
          : "Complete repository setup and the runner check to enable execution.",
        status: project.badgeStatus, href: `/projects/${project.id}`, action: "Prepare project" });
    } else if (project.controlState === "enabled" && project.exclusion === "no-compatible-runner") {
      alerts.push({ id: `runner:${project.id}`, title: `${project.name} needs a compatible runner`,
        reason: "No online runner meets this project's execution requirements.", status: "blocked",
        href: `/projects/${project.id}`, action: "Review project" });
    } else if (["reconciling", "unknown"].includes(project.status) && project.readiness === "ready"
      && !overview.work.some((work) => work.projectId === project.id && work.needsAttention)) {
      alerts.push({ id: `reconcile:${project.id}`, title: `${project.name} needs reconciliation`,
        reason: project.waitingReason ?? "Refresh the project state before retrying work.", status: "reconciling",
        href: `/projects/${project.id}`, action: "Review project" });
    }
  }
  if (overview.workerHealth.status === "stale/unhealthy" || overview.workerHealth.status === "degraded-github") {
    alerts.push({ id: "worker", title: "Worker needs attention", reason: overview.workerHealth.status === "degraded-github"
      ? "The latest worker cycle failed. Review runtime health before starting more work."
      : "A healthy worker cannot be confirmed from the latest heartbeat and cycle evidence.",
    href: "/runners", action: "Check runners", status: "blocked" });
  }
  if (overview.githubSync !== "current" && projects.length > 0) {
    alerts.push({ id: "github", title: "GitHub sync needs checking", reason: "Repository sync is stale or has not been observed. Project status may be incomplete.",
      href: "/settings", action: "Check integration", status: "unknown" });
  }
  if (overview.quota.state !== "normal") {
    alerts.push({ id: "quota", title: "Provider capacity needs attention", reason: overview.quota.reason,
      href: "#capacity", action: "Review capacity", status: overview.quota.state });
  }
  const rank = (status: string) => ["failed", "blocked", "incompatible"].includes(status) ? 0 : status === "waiting-human" ? 1 : 2;
  alerts.sort((a, b) => rank(a.status) - rank(b.status));
  const ready = readiness.filter((project) => project.readiness === "ready").length;
  const enabledReady = readiness.some((project) => project.readiness === "ready" && project.controlState === "enabled");
  const headline = unavailableSections.length ? "Some status information is unavailable"
    : overview.schedulerMode !== "running" ? "Scheduling is paused"
    : projects.length === 0 ? "Connect your first project"
    : alerts.length ? "Attention required"
    : !enabledReady ? "Enable a project to run work" : "Ready for work";
  return {
    headline, ready, readiness, alerts,
    description: overview.schedulerMode !== "running" ? "New work is paused. Check current executions before resuming scheduling."
      : projects.length === 0 ? "Register a repository, prepare ADE, then submit your first task."
      : `${overview.work.filter((item) => item.active).length} executions in progress. ${alerts.length} items need attention.`,
    tone: unavailableSections.length ? "unknown" : alerts.length ? "warn"
      : overview.schedulerMode !== "running" ? "paused" : enabledReady ? "healthy" : "unknown",
    active: overview.work.filter((item) => item.active),
    activityAvailable: !unavailableSections.some((section) => ["Executions", "GitHub work", "Manual tasks", "Workflow stages"].includes(section)),
  };
}

function fallbackProgress(readiness: string): number {
  if (readiness === "ready") return 3_000;
  if (readiness === "incompatible") return 2_000;
  if (readiness === "setup-required") return 1_000;
  return 0;
}
