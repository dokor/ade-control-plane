import Link from "next/link";
import { notFound } from "next/navigation";

import { ControlButton } from "../../../components/ControlButton.js";
import { PriorityForm } from "../../../components/PriorityForm.js";
import { ProjectDeleteButton } from "../../../components/ProjectDeleteButton.js";
import { ProjectSetupAssistant } from "../../../components/ProjectSetupAssistant.js";
import { Shell } from "../../../components/Shell.js";
import { StatusBadge } from "../../../components/StatusBadge.js";
import { requireAuthenticatedContext } from "../../../lib/auth.js";
import { formatInstant } from "../../../lib/format.js";
import { getPersistence } from "../../../lib/persistence.js";
import { loadGithubRuntime } from "../../../lib/githubRuntime.js";
import { inspectProjectSetup } from "../../../lib/projectSetup.js";
import { buildProjectDetail, type TimelineQuery } from "../../../lib/readModel.js";
import { retryabilityExplanation } from "../../../lib/retry.js";
import { projectRefreshPolicy } from "../../../lib/projectRefreshPolicy.js";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const timelineQuery = timelineQueryFromSearch(search);
  const { session, config } = await requireAuthenticatedContext(`/projects/${id}`);
  const persistence = await getPersistence();
  const projectRecord = await persistence.projects.getById(id);
  const detail = await buildProjectDetail({
    persistence,
    quotaProvider: config.quotaProvider,
    quotaAccountRef: config.quotaAccountRef,
    projectId: id,
    adeRuntimeVersion: config.adeRuntimeVersion,
    timeline: timelineQuery,
  });

  if (!detail || !projectRecord) notFound();

  const setupReadiness = await inspectProjectSetup(
    projectRecord,
    await loadGithubRuntime(),
    undefined,
    await persistence.githubWork.getProfile(projectRecord.id),
    config.adeRuntimeVersion,
  );

  const { project, availableActions } = detail;
  const refreshPolicy = projectRefreshPolicy(project, setupReadiness, detail.work);
  const safeRetry = detail.executions.find(
    ({ id: executionId }) => executionId === availableActions.safeRetryExecutionId,
  );
  const latestExecution = detail.executions[0];

  return (
    <Shell
      title={project.name}
      actorRef={session.actorRef}
      refreshIntervalMs={refreshPolicy.intervalMs}
    >
      <p className="muted">
        <Link href="/">← Overview</Link>
      </p>

      <ProjectSetupAssistant project={project} work={detail.work} readiness={setupReadiness} refreshIntervalMs={refreshPolicy.intervalMs} />

      {detail.openDecisions.length > 0 ? (
        <section>
          <h2>Decisions waiting on you</h2>
          <div className="list">
            {detail.openDecisions.map((decision) => (
              <article key={decision.decisionRef} className="panel">
                <div className="row">
                  <strong>{decision.decisionRef}</strong>
                  <span className="muted">{formatInstant(decision.observedAt)}</span>
                </div>
                <p className="detail">{decision.prompt}</p>
                <div className="actions" aria-label={`Resolve ${decision.decisionRef}`}>
                  {decision.options.map((option) => (
                    <ControlButton
                      key={option}
                      type="ade.decide"
                      payload={{
                        projectId: project.id,
                        decisionRef: decision.decisionRef,
                        option,
                      }}
                      label={option}
                      confirm={`Apply the \"${option}\" decision for ${decision.decisionRef}?`}
                    />
                  ))}
                </div>
                <details className="project-disclosure">
                  <summary>Resolve from GitHub instead</summary>
                  <ul className="detail">
                    {decision.githubCommands.map((command) => (
                      <li key={command}>
                        <code>{command}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {detail.humanDecisions.length > 0 && detail.openDecisions.length === 0 ? (
        <section>
          <h2>Human decisions</h2>
          <div className="list">
            {detail.humanDecisions.map((item) => (
              <article key={item.key} className="panel">
                <strong>{item.title}</strong>
                <p className="detail">{item.reason}</p>
                <p className="detail">Recommended: {item.recommendedAction}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <details className="panel project-disclosure" id="project-controls">
        <summary>Project controls</summary>
        <p className="muted">Pause or resume scheduling and adjust project priority.</p>
        <div className="actions">
          <ControlButton
            type="project.pause"
            payload={{ projectId: project.id }}
            label="Pause project"
            disabled={!availableActions.canPause}
            disabledReason="The project is not currently enabled."
          />
          <ControlButton
            type="project.resume"
            payload={{ projectId: project.id }}
            label="Resume project"
            disabled={!availableActions.canResume}
            disabledReason="The project is already enabled."
          />
          <ControlButton
            type="execution.safe-retry"
            payload={{ executionId: safeRetry?.id ?? latestExecution?.id ?? "" }}
            label="Safe retry"
            confirm="Request a safe retry of the last failed execution?"
            disabled={availableActions.safeRetryExecutionId === null}
            disabledReason={
              latestExecution
                ? retryabilityExplanation(latestExecution.retryability)
                : "There is no execution to retry."
            }
          />
        </div>
        {availableActions.safeRetryExecutionId === null && latestExecution ? (
          <p className="muted">{retryabilityExplanation(latestExecution.retryability)}</p>
        ) : null}
        <div className="actions">
          <PriorityForm
            projectId={project.id}
            priority={project.priority}
            variant="default"
            disabled={!availableActions.canReprioritize}
          />
        </div>
      </details>

      <details className="panel project-disclosure">
        <summary>Execution history</summary>
        {detail.executions.length === 0 ? (
          <p className="muted">No execution has been recorded for this project.</p>
        ) : (
          <div className="list">
            {detail.executions.slice(0, 10).map((execution) => (
              <article key={execution.id} className="panel">
                <div className="row">
                  <span>
                    <StatusBadge status={execution.status} />{" "}
                    attempt {execution.attempt} · {execution.capability}
                  </span>
                  <span className="muted">{formatInstant(execution.requestedAt)}</span>
                </div>
                {execution.errorCode ? (
                  <p className="detail">
                    {execution.errorCode}: {execution.errorSummary ?? "no further detail"}
                  </p>
                ) : null}
                <p className="detail">{retryabilityExplanation(execution.retryability)}</p>
              </article>
            ))}
          </div>
        )}
      </details>

      <details className="panel project-disclosure">
        <summary>Timeline</summary>
        <form className="timeline-filters" method="get">
          <label>Type<select name="eventType" defaultValue={timelineQuery.category ?? ""}>
            <option value="">All types</option><option value="project">Project</option><option value="project-onboarding">Project onboarding</option><option value="execution">Execution</option><option value="command">Control</option><option value="github">GitHub</option><option value="github-work">GitHub work</option><option value="worker">Worker</option>
          </select></label>
          <label>Severity<select name="severity" defaultValue={timelineQuery.severity ?? ""}>
            <option value="">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="error">Error</option>
          </select></label>
          <label>Outcome<input name="outcome" placeholder="e.g. failed" defaultValue={timelineQuery.outcome ?? ""} /></label>
          <label>Origin<select name="origin" defaultValue={timelineQuery.origin ?? ""}>
            <option value="">All origins</option><option value="system">System</option><option value="user">User / actionable</option>
          </select></label>
          <label>From<input type="datetime-local" name="from" defaultValue={toDateTimeLocal(timelineQuery.from)} /></label>
          <label>To<input type="datetime-local" name="to" defaultValue={toDateTimeLocal(timelineQuery.to)} /></label>
          <label>Order<select name="order" defaultValue={detail.timelineView.query.order}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </select></label>
          <label>View<select name="mode" defaultValue={detail.timelineView.query.mode}>
            <option value="collapsed">Collapsed</option><option value="all">All events / diagnostic view</option>
          </select></label>
          <div className="actions"><button type="submit">Apply</button><Link className="button secondary" href={`/projects/${id}`}>Reset view</Link></div>
        </form>
        <p className="muted timeline-state">{timelineStateLabel(detail.timelineView.query)}</p>
        {detail.timeline.length === 0 ? (
          <p className="muted">No persisted event yet.</p>
        ) : (
          <div className="timeline">
            {detail.timeline.slice(0, 40).map((entry) => (
              <div key={entry.id} className={`entry ${entry.severity}`}>
                <time>{formatInstant(entry.occurredAt)}</time>
                <div>
                  <div className="timeline-entry-heading">
                    <span className={`timeline-kind ${entry.kind}`}>
                      {entry.kind === "execution" ? "Execution" : entry.kind === "audit" ? "System event" : "Control"}
                    </span>
                    <strong>{entry.title}</strong>
                  </div>
                  {entry.detail ? <span className="muted"> — {entry.detail}</span> : null}
                  {entry.occurrences.length > 1 ? (
                    <details className="timeline-occurrences"><summary>{entry.occurrences.length} occurrences</summary>{entry.occurrences.length > 40 ? <p className="muted">Showing 40 here; use the diagnostic view to page through every original event.</p> : null}<ol>
                      {entry.occurrences.slice(0, 40).map((occurrence) => <li key={occurrence.id}><time>{formatInstant(occurrence.occurredAt)}</time>{occurrence.detail ? ` — ${occurrence.detail}` : ""}</li>)}
                    </ol></details>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <nav className="timeline-pagination" aria-label="Timeline pages">
          {detail.timelineView.hasPrevious ? <Link href={timelineHref(id, detail.timelineView.query, detail.timelineView.query.page - 1)}>Previous</Link> : <span />}
          <span>Page {detail.timelineView.query.page + 1}</span>
          {detail.timelineView.hasNext ? <Link href={timelineHref(id, detail.timelineView.query, detail.timelineView.query.page + 1)}>Next</Link> : <span />}
        </nav>
      </details>
      <details className="panel project-disclosure">
        <summary>Danger zone</summary>
        <p className="detail">This permanently removes the managed local checkout and all ADE Control Plane records. It never deletes the GitHub repository.</p>
        <ProjectDeleteButton projectId={project.id} projectName={project.name} />
      </details>
    </Shell>
  );
}

function one(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function timelineQueryFromSearch(search: Record<string, string | string[] | undefined>): TimelineQuery {
  const severity = one(search.severity);
  const origin = one(search.origin);
  const order = one(search.order);
  const mode = one(search.mode);
  const category = one(search.eventType) || undefined;
  const outcome = one(search.outcome) || undefined;
  const from = parseLocalInstant(one(search.from));
  const to = parseLocalInstant(one(search.to));
  return {
    ...(category ? { category } : {}),
    ...(severity === "info" || severity === "warning" || severity === "error" ? { severity } : {}),
    ...(outcome ? { outcome } : {}),
    ...(origin === "system" || origin === "user" ? { origin } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}),
    order: order === "oldest" ? "oldest" : "newest", mode: mode === "all" ? "all" : "collapsed",
    page: Math.max(0, Number.parseInt(one(search.page) ?? "0", 10) || 0),
  };
}
function parseLocalInstant(value: string | undefined): string | undefined { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.valueOf()) ? undefined : date.toISOString(); }
function toDateTimeLocal(value: string | undefined): string { return value ? value.slice(0, 16) : ""; }
function timelineHref(id: string, query: TimelineQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.category) params.set("eventType", query.category); if (query.severity) params.set("severity", query.severity); if (query.outcome) params.set("outcome", query.outcome); if (query.origin) params.set("origin", query.origin);
  if (query.from) params.set("from", toDateTimeLocal(query.from)); if (query.to) params.set("to", toDateTimeLocal(query.to));
  if (query.order === "oldest") params.set("order", "oldest"); if (query.mode === "all") params.set("mode", "all"); if (page > 0) params.set("page", String(page));
  const suffix = params.toString(); return `/projects/${id}${suffix ? `?${suffix}` : ""}`;
}
function timelineStateLabel(query: TimelineQuery): string {
  const active = [query.category && `type ${query.category}`, query.severity && `severity ${query.severity}`, query.outcome && `outcome ${query.outcome}`, query.origin && `${query.origin} origin`, query.from && `from ${formatInstant(query.from)}`, query.to && `to ${formatInstant(query.to)}`].filter(Boolean);
  return `${query.mode === "all" ? "All events / diagnostic view" : "Collapsed system events"} · ${query.order === "oldest" ? "oldest first" : "newest first"}${active.length ? ` · ${active.join(" · ")}` : " · no filters"}`;
}
