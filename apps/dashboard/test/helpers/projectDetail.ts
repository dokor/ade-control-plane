import type { ProjectSetupPanelProps } from "../../src/components/ProjectSetupPanel.js";
import type { ProjectSetupRequirement } from "../../src/lib/projectSetup.js";
import { buildProjectDetail } from "../../src/lib/readModel.js";
import { overviewFixture } from "./overview.js";
import { NOW, project } from "./fixtures.js";

export const projectDetailStates = ["new", "setup-required", "pr-pending", "initializing", "ready", "incompatible", "stale", "blocked-work", "disabled"] as const;
export async function projectDetailFixture(state: typeof projectDetailStates[number]): Promise<ProjectSetupPanelProps> {
  const { input } = overviewFixture();
  const detail = await buildProjectDetail({ ...input, projectId: project().id });
  if (!detail) throw new Error("Missing fixture project");
  const requirements: ProjectSetupRequirement[] = [
    ["repository-access", "Repository accessible", "repository"], ["ade-config", "ADE configuration", "repository"],
    ["instructions", "Project instructions", "repository"], ["runtime", "ADE runtime compatible", "runtime"],
    ["skills", "Declared ADE skills", "repository"], ["profiles", "Profiles and rules", "repository"],
    ["runner-capability-check", "Runner ADE capability check", "runtime"], ["github-labels", "GitHub workflow labels", "github"],
    ["github-app", "GitHub App access", "runtime"], ["context", "Project context", "repository"], ["issue-template", "ADE issue template", "github"],
  ].map(([key, label, source]) => ({ key: key!, label: label!, source: source as ProjectSetupRequirement["source"], state: "ready", repairable: false, detail: "Check passed." }));
  const props: ProjectSetupPanelProps = {
    project: { ...detail.project, status: "ready", exclusion: null, waitingReason: null,
      adeRuntimeVersion: "0.11.0", adeConfigVersion: "ade.project-setup/v1", resolvedProfiles: ["normal"], resolvedRules: ["review-required"] }, work: [], refreshIntervalMs: 15000,
    readiness: { ready: true, requirements, missingLabels: [], missingFiles: [], plannedFiles: [], invalidFiles: [], checkedAt: NOW,
      capabilitySnapshot: { status: "fresh", observedAt: NOW, checkoutRef: "a".repeat(40) } },
  };
  const update = (key: string, update: Partial<ProjectSetupRequirement>) => Object.assign(requirements.find((item) => item.key === key)!, update);
  update("context", { state: "optional", detail: "Add project context when useful." });
  update("issue-template", { state: "optional", detail: "An optional issue template helps describe work." });
  if (["new", "setup-required", "pr-pending", "initializing", "stale", "incompatible"].includes(state)) {
    props.readiness.ready = false;
    props.readiness.capabilitySnapshot = { status: "unknown", observedAt: null, checkoutRef: null };
    update("runner-capability-check", { state: "missing", detail: "Initialize ADE to verify runner capabilities." });
  }
  if (["new", "setup-required", "pr-pending"].includes(state)) {
    update("ade-config", { state: "missing", repairable: true, detail: "Missing .ade/control-plane.json" });
    update("instructions", { state: "missing", repairable: true, detail: "Add AGENTS.md or CLAUDE.md" });
    props.readiness.plannedFiles = [".ade/control-plane.json", "AGENTS.md"];
    props.readiness.missingFiles = props.readiness.plannedFiles;
  }
  if (state === "new") {
    props.project.adeConfigVersion = null; props.project.resolvedProfiles = []; props.project.resolvedRules = [];
  }
  if (state === "pr-pending") props.readiness.setupPullRequestUrl = "https://github.com/dokor/argos/pull/42";
  if (state === "stale" || state === "incompatible") props.readiness.capabilitySnapshot = { status: state, observedAt: NOW, checkoutRef: "b".repeat(40) };
  if (state === "initializing" || state === "blocked-work") props.work = [{ id: "task-1", projectId: props.project.id,
    projectName: props.project.name, title: state === "initializing" ? "Prepare ADE" : "GitHub issue #21",
    initialization: state === "initializing", active: state === "initializing", needsAttention: state === "blocked-work",
    status: state === "initializing" ? "running" : "blocked", stage: state === "initializing" ? "Executing task" : "checks",
    startedAt: NOW, href: state === "initializing" ? "/tasks/task-1" : `/tasks/github/${props.project.id}/21`, reason: "Required checks failed. Review the workflow." }];
  if (state === "disabled") props.project.controlState = "disabled";
  return props;
}
