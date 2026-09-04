import React, { type ReactNode } from "react";
import Link from "next/link";
import { StatusBadge } from "./StatusBadge.js";
import { formatAge, formatDuration, formatInstant, formatPercent } from "../lib/format.js";
import { summarizeOverview } from "../lib/overview.js";
import type { OverviewViewModel } from "../lib/readModel.js";

export function OverviewContent({ overview, controls, quotaControl }: {
  overview: OverviewViewModel; controls?: ReactNode; quotaControl?: ReactNode;
}) {
  const summary = summarizeOverview(overview);
  const { quota, workerHealth } = overview;
  return <div className="overview">
    <section className="overview-hero" aria-labelledby="health-title">
      <div className="row"><p className="overview-eyebrow">Control Plane · operational overview</p><StatusBadge status={summary.tone}>{summary.tone === "warn" ? "Needs attention" : summary.tone === "unknown" ? "Not confirmed" : summary.tone}</StatusBadge></div>
      <h2 id="health-title">{summary.headline}</h2>
      <p className="muted">{summary.activityAvailable ? summary.description : "Execution information is incomplete. Review the available status below."}</p>
      <div className="overview-signals">
        <div><span>Worker</span><StatusBadge status={workerHealth.status === "stale/unhealthy" ? "unknown" : workerHealth.status}>{workerHealth.status === "stale/unhealthy" ? "Not confirmed" : workerHealth.status}</StatusBadge></div>
        <div><span>Scheduler</span><StatusBadge status={overview.schedulerMode}>{overview.schedulerMode === "safe_mode" ? "Safe mode" : overview.schedulerMode}</StatusBadge></div>
        <div><span>GitHub sync</span><StatusBadge status={overview.githubSync === "current" ? "fresh" : overview.githubSync}>{overview.githubSync}</StatusBadge></div>
      </div>
      <div className="overview-footer"><span className="muted">Updated {formatInstant(overview.generatedAt)}</span><Link className="button primary" href={overview.projects.length ? "/tasks" : "/projects/new"}>{overview.projects.length ? "Open tasks" : "Register a project"}</Link></div>
    </section>

    {overview.unavailableSections.length > 0 && <div className="overview-notice" role="status">
      <strong>Partial view</strong><p>Could not load: {overview.unavailableSections.join(", ")}. Available information is shown below. Refresh to try again.</p>
    </div>}

    <section aria-labelledby="attention-title">
      <div className="overview-section-heading"><h2 id="attention-title">Attention required</h2><span className="muted">{summary.alerts.length} {overview.unavailableSections.length ? "known " : ""}items</span></div>
      {summary.alerts.length === 0 ? <div className="panel overview-calm"><StatusBadge status={overview.unavailableSections.length ? "unknown" : "healthy"} /><p>{overview.unavailableSections.length ? "Some checks are unavailable. Health cannot be confirmed yet." : "No blockers or pending human actions reported."}</p></div>
        : <ul className="overview-attention">{summary.alerts.map((item) => <li key={item.id}>
          <div><StatusBadge status={item.status} /><h3>{item.title}</h3><p className="muted">{item.reason}</p></div>
          <Link href={item.href} aria-label={`${item.action}: ${item.title}`}>{item.action} →</Link>
        </li>)}</ul>}
    </section>

    <section aria-labelledby="active-title">
      <div className="overview-section-heading"><h2 id="active-title">Running now</h2><Link href="/tasks">All tasks →</Link></div>
      {summary.active.length === 0 ? <div className="panel"><p>{summary.activityAvailable ? "No active executions" : "Active work could not be fully loaded"}</p><p className="muted">{summary.activityAvailable ? "New work starts when project readiness, runtime and quota checks allow it." : "Open Tasks or refresh to check the current execution."}</p></div>
        : <ul className="overview-work">{summary.active.map((work) => <li className="panel" key={work.id}>
          <div className="overview-section-heading"><div><p className="overview-eyebrow">{work.projectName}</p><h3><Link href={work.href}>{work.title}</Link></h3></div><StatusBadge status={work.status} /></div>
          <p className="overview-work-stage">{work.stage.replaceAll("-", " ")}</p>
          <p className="muted">{work.startedAt ? `Elapsed ${formatDuration(work.startedAt, null, Date.parse(overview.generatedAt))}` : "Waiting to start"} · <Link href={work.href}>View execution →</Link></p>
        </li>)}</ul>}
    </section>

    <div className="overview-bottom">
      <section id="project-readiness" aria-labelledby="readiness-title">
        <div className="overview-section-heading"><h2 id="readiness-title">Project readiness</h2><Link href="/projects/new">Add project</Link></div>
        <div className="panel">
          <p className="overview-metric">{overview.unavailableSections.includes("Project readiness") ? "Readiness unavailable" : `${summary.ready} of ${overview.projects.length} ADE-ready`}</p>
          {summary.readiness.length === 0 ? <p className="muted">Your repositories will appear here after registration.</p>
            : <ul className="overview-projects">{summary.readiness.map((project) => <li key={project.id}><Link href={`/projects/${project.id}`}>{project.name}</Link><span><StatusBadge status={project.readiness} />{project.controlState === "paused" && <> <StatusBadge status="paused" /></>}</span></li>)}</ul>}
        </div>
      </section>

      <section id="capacity" aria-labelledby="capacity-title">
        <div className="overview-section-heading"><h2 id="capacity-title">AI capacity</h2><Link href="/analytics">AI usage →</Link></div>
        <div className="panel">
          <div className="row"><strong>{quota.provider}</strong><StatusBadge status={quota.state} /></div>
          <p className="muted">{quota.accountRef}</p>
          <p className="overview-metric">{quota.usedPercent === null ? "Usage not reported" : `${formatPercent(quota.usedPercent)} used`}</p>
          {quota.usedPercent !== null && <meter min={0} max={100} value={quota.usedPercent} aria-label={`${quota.provider} quota used`}>{formatPercent(quota.usedPercent)}</meter>}
          <p>{quota.canStartWork ? "Quota permits new work." : "Quota does not permit new work."}</p>
          <p className="muted">{quota.reason}</p>
          <p className="muted">{quota.resetsAt ? `Next reset ${formatInstant(quota.resetsAt)}` : "Reset time not reported"}<br />Snapshot {formatAge(quota.snapshotAgeMs)}</p>
          {quotaControl}
        </div>
      </section>
    </div>
    <details className="overview-controls"><summary>Scheduling controls & runtime</summary><p className="muted">{overview.schedulerExplanation}</p><p className="muted">ADE runtime {overview.adeRuntimeVersion}. Worker heartbeat {formatInstant(workerHealth.lastHeartbeatAt)}.</p>{controls}</details>
  </div>;
}

export function OverviewUnavailable() {
  return <section className="overview overview-notice" role="status"><h2>Overview temporarily unavailable</h2><p>The Control Plane status could not be loaded. Refresh to try again.</p><Link href="/tasks">Open Tasks →</Link></section>;
}

export function OverviewLoading() {
  return <div className="overview" aria-busy="true" role="status" aria-label="Loading Overview">
    <div className="overview-hero"><p className="overview-eyebrow">Control Plane</p><h2>Loading Overview…</h2><p>Checking operational status and work requiring attention.</p></div>
    <div className="overview-loading" aria-hidden="true" /><div className="overview-loading" aria-hidden="true" />
  </div>;
}
