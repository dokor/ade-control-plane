import type { ProjectSetupReadiness } from "./projectSetup.js";
import { projectSetupPhase } from "./projectSetupPhase.js";
import type { OverviewWorkItem, ProjectView } from "./readModel.js";

export function summarizeProjectDetail(project: ProjectView, readiness: ProjectSetupReadiness, work: readonly OverviewWorkItem[]) {
  const initialization = work.find((item) => item.initialization && item.active);
  const phase = initialization ? "initialization" : projectSetupPhase(readiness);
  const failedInitialization = work.find((item) => item.initialization && item.status === "failed");
  const blocker = readiness.requirements.find((item) => item.key !== "runner-capability-check"
    && item.state !== "ready" && item.state !== "optional" && !item.repairable);
  const attention = work.find((item) => item.needsAttention && !item.initialization);
  type Action = { label: string; href?: string; prepare?: boolean; refresh?: boolean };
  let status = "ready", label = "Ready", reason = "ADE is verified on the default branch. Choose or submit work to continue.";
  let action: Action = { label: "Open tasks", href: "/tasks" };
  if (project.controlState !== "enabled") {
    status = "disabled"; label = project.controlState === "paused" ? "Paused" : "Disabled";
    reason = "Project scheduling is disabled. Review project controls to resume it.";
    action = { label: "Review controls", href: "#project-controls" };
  } else if (initialization) {
    status = "initializing"; label = "Initializing";
    reason = initialization.status === "pending" ? "ADE initialization is queued. Follow the task for progress and any generated PR."
      : "The worker is preparing ADE. Follow the task for progress and any generated PR.";
    action = { label: "View initialization", href: initialization.href };
  } else if (blocker) {
    status = blocker.key === "ade-config" || blocker.key === "profiles" ? "incompatible" : "blocked";
    label = status === "incompatible" ? "Incompatible" : "Blocked";
    reason = blocker.detail;
    action = { label: "Review required fixes", href: "#project-checks" };
  } else if (phase === "repository") {
    status = "setup-required"; label = "Setup required";
    reason = readiness.setupPullRequestUrl ? "The setup PR is awaiting review. Merge it, then refresh checks to continue."
      : "Required repository setup is missing. Prepare the missing files and GitHub labels before initializing ADE.";
    action = readiness.setupPullRequestUrl ? { label: "Review setup PR", href: readiness.setupPullRequestUrl }
      : readiness.setupPullRequestLookupFailed ? { label: "Retry PR lookup", refresh: true }
      : { label: readiness.plannedFiles.length ? "Create setup PR" : "Create missing labels", prepare: true };
    if (readiness.setupPullRequestLookupFailed) reason = "Repository checks completed, but the setup PR could not be checked. Refresh before preparing setup.";
  } else if (phase === "initialization") {
    status = readiness.capabilitySnapshot?.status === "incompatible" ? "incompatible" : failedInitialization ? "blocked" : "setup-required";
    label = status === "incompatible" ? "Incompatible" : status === "blocked" ? "Blocked" : "Setup required";
    reason = readiness.capabilitySnapshot?.status === "stale" ? "The last runner check used an older revision. Initialize ADE again to verify the default branch."
      : failedInitialization ? "ADE initialization failed. Review the task logs before retrying."
      : readiness.capabilitySnapshot?.status === "incompatible" ? "The runner could not validate ADE. Review capability details and correct the configuration before retrying."
      : "Repository setup is complete. Start ADE initialization to prepare configuration and verify runner capabilities.";
    action = { label: "Start ADE initialization", prepare: true };
  } else if (attention) {
    status = "blocked"; label = "Blocked"; reason = attention.reason;
    action = { label: "Review blocked work", href: attention.href };
  } else if (project.status === "paused") {
    status = "paused"; label = "Scheduling paused";
    reason = project.waitingReason ?? "Global scheduling is paused.";
    action = { label: "Review scheduling", href: "/" };
  } else if (project.exclusion === "no-compatible-runner") {
    status = "waiting-runner"; label = "Waiting for runner";
    reason = "ADE setup is complete, but no compatible runner is online.";
    action = { label: "Check runners", href: "/runners" };
  } else if (["waiting-human", "waiting-quota", "reconciling", "unknown", "failed"].includes(project.status)) {
    status = project.status; label = project.status === "waiting-quota" ? "Waiting for capacity" : "Attention required";
    reason = project.waitingReason ?? "Work needs attention before it can continue.";
    action = { label: "Review work", href: "#project-work" };
  } else {
    const active = work.find((item) => item.active);
    if (active) { reason = "ADE is ready and work is in progress."; action = { label: "View current work", href: active.href }; }
  }
  return { phase, status, label, reason, action, initializing: Boolean(initialization),
    stepBlocked: Boolean(blocker) || (phase === "initialization" && ["blocked", "incompatible"].includes(status)),
    visibleWork: work.filter((item) => (item.active || item.needsAttention || ["ready", "pending", "queued"].includes(item.status))
      && (!item.initialization || item.active || !readiness.ready)) };
}
