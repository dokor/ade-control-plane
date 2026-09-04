import React from "react";
import { formatInstant } from "../lib/format.js";
import type { ProjectSetupReadiness, ProjectSetupRequirement } from "../lib/projectSetup.js";
import { summarizeProjectDetail } from "../lib/projectDetailPresentation.js";
import type { OverviewWorkItem, ProjectView } from "../lib/readModel.js";
import { ProjectSetupRequirementHelp } from "./ProjectSetupRequirementHelp.js";
import { StatusBadge } from "./StatusBadge.js";

export interface ProjectSetupPanelProps {
  project: ProjectView;
  work: readonly OverviewWorkItem[];
  readiness: ProjectSetupReadiness;
  refreshIntervalMs: number;
  pending?: boolean;
  refreshing?: boolean;
  message?: string | null;
  error?: boolean;
  onPrepare?: () => void;
  onRefresh?: () => void;
  workExpanded?: boolean;
  onToggleWork?: () => void;
}

const groups = [
  { title: "Repository setup", keys: ["repository-access", "ade-config", "instructions", "context", "issue-template"] },
  { title: "ADE capabilities", keys: ["runtime", "skills", "profiles", "runner-capability-check"] },
  { title: "GitHub integration", keys: ["github-labels", "github-app"] },
];
const optional = (item: ProjectSetupRequirement) => ["context", "issue-template"].includes(item.key);
function checkLabel(item: ProjectSetupRequirement, readiness: ProjectSetupReadiness): string {
  if (item.state !== "missing") return item.label;
  if (item.key === "ade-config") return "Missing .ade/control-plane.json";
  if (item.key === "instructions") return "Add AGENTS.md or CLAUDE.md";
  if (item.key === "github-labels") return `Missing labels: ${readiness.missingLabels.map((label) => label.name).join(", ")}`;
  return item.label;
}

export function ProjectSetupPanel({ project, work, readiness, refreshIntervalMs, pending, refreshing,
  message, error, onPrepare, onRefresh, workExpanded = false, onToggleWork }: ProjectSetupPanelProps) {
  const summary = summarizeProjectDetail(project, readiness, work);
  const activeStep = summary.phase === "repository" ? 0 : summary.phase === "initialization" ? 1 : 2;
  const snapshot = readiness.capabilitySnapshot;
  const required = readiness.requirements.filter((item) => !optional(item));
  const missing = required.filter((item) => item.state !== "ready").length;
  const action = summary.action;
  return <div className="project-detail">
    <header className="project-headline">
      <a href={project.repositoryUrl} target="_blank" rel="noreferrer noopener">{project.repositoryUrl.replace("https://github.com/", "")}</a>
      <h2>Project status <StatusBadge status={summary.status}>{summary.label}</StatusBadge></h2>
      <p>{summary.reason}</p>
    </header>
    <section className="panel project-setup" aria-labelledby="ade-setup-title">
      <h2 id="ade-setup-title">ADE Setup</h2>
      <ol className="setup-process" aria-label="ADE onboarding process">
        {["Prepare repository", "Initialize ADE", "Ready for work"].map((title, index) => {
          const current = index === activeStep;
          const done = index < activeStep || (index === 2 && readiness.ready);
          const state = done ? "Done" : current ? summary.stepBlocked ? "Blocked" : summary.initializing ? "In progress"
            : readiness.setupPullRequestUrl ? "PR pending" : "Action required" : "Pending";
          return <li key={title} className={`setup-process-step ${current ? "current" : done ? "complete" : "pending"}`} aria-current={current ? "step" : undefined}>
            <span className="setup-process-index" aria-hidden="true">{done ? "✓" : index + 1}</span>
            <div className="setup-process-copy"><strong>{title}</strong>
              <StatusBadge status={done ? "ready" : state === "Blocked" ? "blocked" : "setup-required"}>{state}</StatusBadge>
              {current ? <>
                {action.href ? <a className="button primary" href={action.href} target={action.href.startsWith("https:") ? "_blank" : undefined} rel={action.href.startsWith("https:") ? "noreferrer noopener" : undefined}>{action.label}</a>
                  : <button className="primary" type="button" disabled={pending || refreshing} onClick={action.refresh ? onRefresh : onPrepare}>
                    {pending ? "Preparing…" : refreshing ? "Refreshing…" : action.label}</button>}
                {action.prepare ? <p className="muted">{summary.phase === "repository"
                  ? "Missing labels are added now. Any file changes go through a PR for your review."
                  : "Queues one worker task. Review any generated PR before merging."}</p> : null}
              </> : null}
            </div>
          </li>;
        })}
      </ol>
      {message ? <p role={error ? "alert" : "status"} className={error ? "error" : "detail"}>{message}</p> : null}
      <div id="project-checks" className="project-checks" tabIndex={-1}>
        <h3>Required checks <span className="muted">{missing ? `${missing} need attention` : "All passed"}</span></h3>
        <div className="project-check-groups">{groups.map((group) => <section key={group.title}>
          <h4>{group.title}</h4>
          <ul>{required.filter((item) => group.keys.includes(item.key)).sort((a, b) => Number(a.state === "ready") - Number(b.state === "ready")).map((item) =>
            <li key={item.key} className={`project-check ${item.state !== "ready" ? "needs-action" : ""}`}>
              <details>
                <summary>{checkLabel(item, readiness)}</summary>
                <p className="detail">{item.detail}</p>
                {item.state !== "ready" ? <ProjectSetupRequirementHelp requirement={item} /> : null}
              </details>
              <StatusBadge status={item.state}>{item.state === "ready" ? "Ready" : item.state === "invalid" ? "Invalid" : "Required"}</StatusBadge>
            </li>)}
          </ul>
        </section>)}</div>
      </div>
      <details className="project-disclosure"><summary>Optional improvements · do not block readiness</summary>
        <ul>{readiness.requirements.filter(optional).map((item) => <li key={item.key}>
          <strong>{item.label}</strong> <StatusBadge status={item.state === "ready" ? "ready" : "optional"}>{item.state === "ready" ? "Ready" : "Optional"}</StatusBadge>
          <p className="muted">{item.detail}</p>
        </li>)}</ul>
      </details>
    </section>
    <section className="panel project-state" aria-labelledby="project-state-title">
      <h2 id="project-state-title">Project state</h2>
      <div className="project-state-columns">
        <div><h3>ADE environment</h3>
          <p><StatusBadge status={snapshot?.status ?? "unknown"}>{!snapshot || snapshot.status === "unknown" ? "Not yet evaluated"
            : snapshot.status === "fresh" ? "Verified on default branch" : snapshot.status === "stale" ? "Older revision — recheck required" : "Capability check failed"}</StatusBadge></p>
          <p className="detail">{!snapshot || snapshot.status === "unknown" ? "No runner capability result is available yet. Repository checks do not verify the worker checkout."
            : `Last capability result: ${formatInstant(snapshot.observedAt)}`}</p>
          <dl className="project-metadata">
            <dt>Runtime</dt><dd>{project.adeRuntimeVersion}</dd>
            <dt>Config</dt><dd>{project.adeConfigVersion ?? (snapshot?.status === "fresh" ? "Version not reported" : "Not validated by runner")}</dd>
            <dt>Profiles</dt><dd>{project.resolvedProfiles.join(", ") || "Not reported"}</dd>
            <dt>Rules</dt><dd>{project.resolvedRules.join(", ") || "Not reported"}</dd>
          </dl>
        </div>
        <div id="project-work" tabIndex={-1}><h3>Work</h3>
          {summary.visibleWork.length ? <ul id="project-work-list" className="project-work-list">{(workExpanded ? summary.visibleWork : summary.visibleWork.slice(0, 3)).map((item) => <li key={item.id}>
            <a href={item.href}>{item.title}</a> <StatusBadge status={item.status} />
            <p className="detail">{item.active ? "Current" : item.needsAttention ? "Needs attention" : "Next / available"} · {item.stage}</p>
            {item.reason ? <p className="muted">{item.reason}</p> : null}
          </li>)}</ul> : <p className="muted">No current or queued work.</p>}
          {summary.visibleWork.length > 3 ? <button type="button" aria-expanded={workExpanded} aria-controls="project-work-list" onClick={onToggleWork}>
            {workExpanded ? "Voir moins" : "Voir plus"}
          </button> : null}
          {project.waitingReason ? <p className="detail">Scheduling: {project.waitingReason}</p> : null}
        </div>
      </div>
    </section>
    <details className="panel project-disclosure"><summary>Technical details &amp; refresh</summary>
      <p className="muted">Last repository check: {formatInstant(readiness.checkedAt)}. Checks refresh every {Math.max(5, Math.ceil(refreshIntervalMs / 1000))} seconds while this tab is visible.</p>
      <button type="button" onClick={onRefresh} disabled={refreshing || pending}>{refreshing ? "Refreshing…" : "Refresh checks"}</button>
      {readiness.setupPullRequestUrl ? <p><a href={readiness.setupPullRequestUrl} target="_blank" rel="noreferrer noopener">View setup PR</a></p> : null}
      <dl className="project-metadata">
        <dt>Planned files</dt><dd>{readiness.plannedFiles.join(", ") || "None"}</dd>
        <dt>Planned labels</dt><dd>{readiness.missingLabels.map((item) => item.name).join(", ") || "None"}</dd>
        <dt>Manual corrections</dt><dd>{readiness.invalidFiles.join(", ") || "None"} · Existing files are preserved.</dd>
        <dt>Runner revision</dt><dd>{snapshot?.checkoutRef ?? "No checkout result"}</dd>
        <dt>ADE compatibility</dt><dd>{project.adeStatus}</dd>
        <dt>Scheduling</dt><dd>{project.controlState} · priority {project.priority}</dd>
        <dt>Work observation</dt><dd>{project.snapshotAgeMs === null ? "No work snapshot" : `${formatInstant(project.snapshotObservedAt)} · ${project.snapshotFresh ? "Fresh" : "Stale"}`}</dd>
        <dt>Stage / milestone</dt><dd>{project.stage ?? "Not reported"} / {project.milestone ?? "Not reported"}</dd>
      </dl>
      <p className="muted">Missing: setup is needed. Not evaluated: no result yet. Stale: the checked revision changed. Invalid or incompatible: a check failed. Optional: does not block readiness.</p>
    </details>
  </div>;
}
