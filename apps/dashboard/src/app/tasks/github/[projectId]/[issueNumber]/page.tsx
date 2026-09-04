import Link from "next/link";
import { notFound } from "next/navigation";

import { ControlButton } from "../../../../../components/ControlButton.js";
import { GithubWorkRemoveButton } from "../../../../../components/GithubWorkRemoveButton.js";
import { Shell } from "../../../../../components/Shell.js";
import { requireAuthenticatedContext } from "../../../../../lib/auth.js";
import { formatInstant } from "../../../../../lib/format.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { buildGithubWorkDetail, safePullRequestUrl } from "../../../../../lib/taskReadModel.js";

export const dynamic = "force-dynamic";

export default async function GithubWorkDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; issueNumber: string }>;
}) {
  const { projectId, issueNumber: rawIssueNumber } = await params;
  const issueNumber = Number(rawIssueNumber);
  const { session, config } = await requireAuthenticatedContext(`/tasks/github/${projectId}/${rawIssueNumber}`);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) notFound();
  const detail = await buildGithubWorkDetail(await getPersistence(), projectId, issueNumber);
  if (!detail) notFound();
  const { project, work, workflow, execution } = detail;
  const pullRequestUrl = safePullRequestUrl(workflow?.pullRequestUrl ?? null);
  const openDecision = detail.decision?.status === "open" ? detail.decision.options : [];

  return (
    <Shell title={`Issue #${issueNumber} workflow`} actorRef={session.actorRef} refreshIntervalMs={config.refreshIntervalMs}>
      <p className="task-back"><Link href="/tasks">&lt;- Task runway</Link></p>
      <section className="task-detail-hero">
        <div>
          <p className="task-kicker">ADE GitHub workflow · {workflow?.id.slice(0, 8) ?? "not started"}</p>
          <h2>{project.name} · issue #{issueNumber}</h2>
          <p>{project.repositoryOwner}/{project.repositoryName}</p>
        </div>
        <div className="task-detail-state">
          <span className={`badge ${work.state}`}>{detail.stageLabel}</span>
          {pullRequestUrl ? <a className="button primary" href={pullRequestUrl} target="_blank" rel="noreferrer noopener">Open PR #{workflow?.pullRequestNumber}</a> : null}
          <a className="button" href={work.issueUrl} target="_blank" rel="noreferrer noopener">Open issue</a>
          {execution && ["queued", "leased", "dispatched", "running"].includes(execution.status) ? <ControlButton
            type="execution.cancel" payload={{ executionId: execution.id }} label={execution.cancelRequested ? "Cancellation requested" : "Cancel execution"}
            confirm="Request cancellation of this execution? Wait for confirmed termination before removing its records."
            disabled={execution.cancelRequested === true} disabledReason="Waiting for the worker to confirm cancellation." /> : null}
        </div>
      </section>

      <dl className="task-detail-meta">
        <div><dt>Source revision</dt><dd>{work.sourceUpdatedAt}</dd></div>
        <div><dt>Execution</dt><dd>{execution ? `${execution.id.slice(0, 8)} · ${execution.status}` : "not scheduled"}</dd></div>
        <div><dt>Branch</dt><dd>{workflow?.branchName ?? work.branchName ?? "not created yet"}</dd></div>
        <div><dt>Head SHA</dt><dd>{workflow?.headSha?.slice(0, 12) ?? "not pushed"}</dd></div>
        <div><dt>Heartbeat</dt><dd>{detail.heartbeatAt ? formatInstant(detail.heartbeatAt) : "not active"}</dd></div>
        <div><dt>Deadline</dt><dd>{detail.deadlineAt ? formatInstant(detail.deadlineAt) : "not active"}</dd></div>
        <div><dt>Retry classification</dt><dd>{workflow?.retryClassification ?? work.retryPolicy}</dd></div>
        <div><dt>Reconciliation</dt><dd>{workflow?.reconciliationRequired || execution?.status === "unknown" ? "required" : "not required"}</dd></div>
        <div><dt>Cancellation</dt><dd>{execution?.cancelRequested ? "requested" : execution?.status === "cancelled" ? "confirmed" : "not requested"}</dd></div>
      </dl>

      <section className={`task-outcome ${detail.firstFailure ? "failed" : "running"}`} aria-live="polite">
        <div>
          <p className="task-kicker">Current action</p>
          <h2>{detail.stageLabel}</h2>
          <p>{detail.nextAction}</p>
          {detail.firstFailure ? <p className="task-outcome-failure">First failure: {detail.firstFailure.title} — {detail.firstFailure.detail}</p> : null}
        </div>
        <div className="task-outcome-stats"><strong>{detail.transitions.length}</strong><span>durable stages recorded</span></div>
      </section>

      {detail.decision?.status === "open" ? (
        <section className="task-log-section">
          <div className="task-history-heading"><div><p className="task-kicker">Human gate</p><h2>{detail.decision.prompt}</h2></div><span>{detail.decision.decisionRef}</span></div>
          <div className="actions">
            {openDecision.map((option) => (
              <ControlButton key={option} type="ade.decide" payload={{ projectId, decisionRef: detail.decision?.decisionRef, option }} label={option} variant="primary" confirm={`Apply ADE option “${option}”?`} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="task-log-section">
        <div className="task-history-heading"><div><p className="task-kicker">Validation evidence</p><h2>Deterministic checks and profile reviews</h2></div></div>
        <div className="task-detail-meta">
          <div><dt>Deterministic validation</dt><dd>{detail.validationSummary ?? "Not recorded yet."}</dd></div>
          <div><dt>AI profile review</dt><dd>{detail.reviewSummary ?? "Not recorded yet."}</dd></div>
        </div>
      </section>

      {Object.keys(detail.provenance).length > 0 ? (
        <section className="task-log-section">
          <div className="task-history-heading"><div><p className="task-kicker">ADE provenance</p><h2>Runtime and policy evidence</h2></div></div>
          <dl className="task-detail-meta">{Object.entries(detail.provenance).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        </section>
      ) : null}

      <section className="task-log-section">
        <div className="task-history-heading"><div><p className="task-kicker">Durable evidence</p><h2>Workflow timeline</h2></div><span>{detail.events.length} events</span></div>
        {detail.events.length === 0 ? <div className="task-history-empty">Waiting for the worker to record the first workflow transition.</div> : (
          <ol className="task-execution-timeline">
            {detail.events.map((event) => <li key={event.id} className={`task-execution-event ${event.status}`}><span className="task-execution-marker" aria-hidden="true" /><div className="task-execution-content"><div className="task-execution-heading"><span className={`task-event-kind ${event.kind}`}>{event.kind}</span><strong>{event.title}</strong><span className={`task-event-status ${event.status}`}>{event.status}</span></div><time dateTime={event.occurredAt}>{formatInstant(event.occurredAt)}</time><p>{event.detail}</p></div></li>)}
          </ol>
        )}
      </section>

      <section className="task-log-section">
        <div className="task-history-heading"><div><p className="task-kicker">Stage ledger</p><h2>Completed and pending stages</h2></div></div>
        <div className="task-history">{detail.transitions.map((stage) => <article className="task-history-row" key={`${stage.stage}:${stage.occurredAt}`}><div className="task-history-status"><span className="badge badge-neutral">{stage.label}</span><time>{formatInstant(stage.occurredAt)}</time></div><div className="task-history-main"><h3>Attempt {stage.attempt}</h3><p>{stage.reason}</p></div></article>)}</div>
      </section>
      <details className="panel project-disclosure">
        <summary>Remove this work item</summary>
        <p>Remove only Control Plane records. The GitHub issue, branches and PRs are preserved. Active or unconfirmed executions must be cancelled or reconciled first.</p>
        <GithubWorkRemoveButton projectId={projectId} issueNumber={issueNumber} workId={work.id} />
      </details>
    </Shell>
  );
}
