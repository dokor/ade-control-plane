import { summarizeProjectDetail } from "./projectDetailPresentation.js";
import type { ProjectSetupReadiness } from "./projectSetup.js";
import type { OverviewWorkItem, ProjectView } from "./readModel.js";

export interface OverviewProjectReadinessPresentation {
  id: string;
  /** ADE setup readiness only; operational project status is represented separately. */
  setupReady: boolean;
  status: string;
  label: string;
  reason: string;
  actionLabel: string;
  actionHref: string;
  phase: string;
  needsAttention: boolean;
  progress: number;
}

export function presentOverviewProjectReadiness(
  project: ProjectView,
  readiness: ProjectSetupReadiness,
  work: readonly OverviewWorkItem[],
): OverviewProjectReadinessPresentation {
  const summary = summarizeProjectDetail(project, readiness, work);
  const required = readiness.requirements.filter((item) => !["context", "issue-template"].includes(item.key));
  const passed = required.filter((item) => item.state === "ready").length;
  const phaseRank = summary.phase === "ready" ? 3 : summary.phase === "initialization" ? 2 : 1;

  return {
    id: project.id,
    setupReady: readiness.ready,
    status: summary.status,
    label: summary.label,
    reason: summary.reason,
    actionLabel: summary.action.label,
    actionHref: overviewProjectActionHref(project.id, summary.action.href),
    phase: summary.phase,
    needsAttention: ["setup-required", "incompatible", "blocked", "waiting-human", "reconciling", "unknown", "failed"].includes(summary.status),
    progress: phaseRank * 1_000 + passed * 10 + (summary.initializing ? 5 : 0),
  };
}

function overviewProjectActionHref(projectId: string, href: string | undefined): string {
  if (!href) return `/projects/${projectId}`;
  if (href.startsWith("#")) return `/projects/${projectId}${href}`;
  return href;
}
