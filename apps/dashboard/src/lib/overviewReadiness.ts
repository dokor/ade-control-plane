import { summarizeProjectDetail } from "./projectDetailPresentation.js";
import type { ProjectSetupReadiness } from "./projectSetup.js";
import type { OverviewWorkItem, ProjectView } from "./readModel.js";

export interface OverviewProjectReadinessPresentation {
  id: string;
  ready: boolean;
  status: string;
  label: string;
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
    ready: readiness.ready,
    status: summary.status,
    label: summary.label,
    progress: phaseRank * 1_000 + passed * 10 + (summary.initializing ? 5 : 0),
  };
}
