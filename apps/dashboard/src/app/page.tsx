import Link from "next/link";

import { ControlButton } from "../components/ControlButton.js";
import { Shell } from "../components/Shell.js";
import { requireAuthenticatedContext } from "../lib/auth.js";
import { formatAge, formatInstant, formatPercent } from "../lib/format.js";
import { getPersistence } from "../lib/persistence.js";
import { buildOverview } from "../lib/readModel.js";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { session, config } = await requireAuthenticatedContext("/");
  const overview = await buildOverview({
    persistence: await getPersistence(),
    quotaProvider: config.quotaProvider,
    quotaAccountRef: config.quotaAccountRef,
  });

  return (
    <Shell
      title="Overview"
      actorRef={session.actorRef}
      refreshIntervalMs={config.refreshIntervalMs}
    >
      <div className="cards">
        <article className="card">
          <h2>Scheduler</h2>
          <p className="value">
            <span className={`badge ${overview.schedulerMode === "running" ? "ok" : "warn"}`}>
              {overview.schedulerMode}
            </span>
          </p>
          <p className="detail">{overview.schedulerExplanation}</p>
          <div className="actions">
            {overview.schedulerMode === "running" ? (
              <ControlButton
                type="global.pause"
                label="Pause globally"
                variant="danger"
                confirm="Pause all scheduling? No new privileged dispatch will start."
              />
            ) : (
              <ControlButton
                type="global.resume"
                label="Resume"
                variant="primary"
                confirm="Resume global scheduling?"
              />
            )}
            <ControlButton
              type="global.safe-mode"
              label="Safe mode"
              confirm="Enable safe mode? Only reconciliation continues."
              disabled={overview.schedulerMode === "safe_mode"}
              disabledReason="Safe mode is already enabled."
            />
          </div>
        </article>

        <article className="card">
          <h2>Provider quota</h2>
          <p className="value">
            <span className={`badge ${overview.quota.state === "normal" ? "ok" : "warn"}`}>
              {overview.quota.state}
            </span>{" "}
            {formatPercent(overview.quota.usedPercent)}
          </p>
          <p className="detail">
            {overview.quota.provider} / {overview.quota.accountRef}
            <br />
            Resets {formatInstant(overview.quota.resetsAt)}
            <br />
            Window {overview.quota.windowDurationMins === null ? "unknown" : `${overview.quota.windowDurationMins}m`}
            <br />
            Snapshot {formatAge(overview.quota.snapshotAgeMs)}
          </p>
          <p className="detail">{overview.quota.reason}</p>
        </article>

        <article className="card">
          <h2>Runners</h2>
          <p className="value">{overview.runners.filter((runner) => runner.healthy).length}/{overview.runners.length}</p>
          <p className="detail">{overview.runnerHealthSummary}</p>
          <p className="detail">
            <Link href="/runners">Manage runners</Link>
          </p>
        </article>

        <article className="card">
          <h2>Active execution</h2>
          {overview.activeExecutions.length === 0 ? (
            <p className="detail">Nothing is executing right now.</p>
          ) : (
            overview.activeExecutions.map((execution) => (
              <p key={execution.id} className="detail">
                <span className="badge running">{execution.status}</span>{" "}
                {execution.projectName} — {execution.capability}
                <br />
                since {formatInstant(execution.startedAt ?? execution.requestedAt)}
              </p>
            ))
          )}
        </article>
      </div>

      <section>
        <h2>Attention queue</h2>
        {overview.attention.length === 0 ? (
          <p className="muted">Nothing needs a human decision.</p>
        ) : (
          <div className="list">
            {overview.attention.map((item) => (
              <article key={item.key} className="panel">
                <div className="row">
                  <strong>{item.title}</strong>
                  <span className="muted">{formatInstant(item.since)}</span>
                </div>
                <p className="detail">{item.reason}</p>
                <p className="detail">Recommended: {item.recommendedAction}</p>
                {item.href ? <Link href={item.href}>Open</Link> : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Projects</h2>
        {overview.projects.length === 0 ? (
          <p className="muted">No project is registered yet.</p>
        ) : (
          <div className="list">
            {overview.projects.map((project) => (
              <article key={project.id} className="panel">
                <div className="row">
                  <strong>
                    <Link href={`/projects/${project.id}`}>{project.name}</Link>
                  </strong>
                  <span>
                    <span className={`badge ${project.status}`}>{project.status}</span>{" "}
                    <span className="badge">priority {project.priority}</span>
                  </span>
                </div>
                <p className="detail">
                  {project.stage ? `Stage ${project.stage}` : "Stage unknown"}
                  {project.milestone ? ` · ${project.milestone}` : ""}
                  {" · snapshot "}
                  {formatAge(project.snapshotAgeMs)}
                  {project.snapshotFresh ? "" : " (stale)"}
                </p>
                {project.currentWorkSummary ? (
                  <p className="detail">Current: {project.currentWorkSummary}</p>
                ) : null}
                {project.waitingReason ? (
                  <p className="detail">Waiting: {project.waitingReason}</p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
