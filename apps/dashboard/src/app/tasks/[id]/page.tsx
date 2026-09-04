import Link from "next/link";
import { notFound } from "next/navigation";

import { Shell } from "../../../components/Shell.js";
import { ExecutionFailureDetails } from "../../../components/ExecutionFailureDetails.js";
import { TaskCancelButton } from "../../../components/TaskCancelButton.js";
import { TaskPrRetryButton } from "../../../components/TaskPrRetryButton.js";
import { requireAuthenticatedContext } from "../../../lib/auth.js";
import { formatDuration, formatInstant } from "../../../lib/format.js";
import { loadGithubRuntime } from "../../../lib/githubRuntime.js";
import { getPersistence } from "../../../lib/persistence.js";
import { buildTaskDetail, safePullRequestUrl } from "../../../lib/taskReadModel.js";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, config } = await requireAuthenticatedContext(`/tasks/${id}`);
  const github = await loadGithubRuntime();
  const detail = await buildTaskDetail(await getPersistence(), id, github?.issueReader);
  if (!detail) notFound();

  const { task, project, logs } = detail;
  const active = task.status === "PENDING" || task.status === "RUNNING";
  const pullRequestUrl = safePullRequestUrl(task.pullRequestUrl);

  return (
    <Shell
      title={`${project.name} task`}
      actorRef={session.actorRef}
      refreshIntervalMs={config.refreshIntervalMs}
    >
      <p className="task-back"><Link href="/tasks">&lt;- Task runway</Link></p>

      <section className="task-detail-hero">
        <div>
          <p className="task-kicker">Execution {task.id.slice(0, 8)}</p>
          <h2>{detail.title}</h2>
          <p>{project.repositoryOwner}/{project.repositoryName}</p>
        </div>
        <div className="task-detail-state">
          <span className={`badge ${task.status.toLowerCase()}`}>{task.status}</span>
          {active ? (
            <TaskCancelButton
              taskId={task.id}
              status={task.status as "PENDING" | "RUNNING"}
            />
          ) : null}
          {task.status === "FAILED" && task.errorCode === "GITHUB_PR_CREATE_FAILED" ? <TaskPrRetryButton taskId={task.id} /> : null}
          {pullRequestUrl ? (
            <a className="button primary" href={pullRequestUrl} target="_blank" rel="noreferrer noopener">
              Open PR #{task.pullRequestNumber}
            </a>
          ) : null}
        </div>
      </section>

      <dl className="task-detail-meta">
        <div><dt>Source</dt><dd>{task.source.type === "github-issue"
          ? <a href={`https://github.com/${project.repositoryOwner}/${project.repositoryName}/issues/${task.source.issueNumber}`} target="_blank" rel="noreferrer noopener">GitHub issue #{task.source.issueNumber}</a>
          : task.source.type === "ade-initialize" ? "Initialisation ADE" : "Prompt libre"}</dd></div>
        <div><dt>Created</dt><dd>{formatInstant(task.createdAt)}</dd></div>
        <div><dt>Started</dt><dd>{formatInstant(task.startedAt)}</dd></div>
        <div><dt>Finished</dt><dd>{formatInstant(task.finishedAt)}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(task.startedAt, task.finishedAt)}</dd></div>
        <div><dt>Branch</dt><dd>{task.branchName ?? "not created yet"}</dd></div>
      </dl>

      <section className={`task-outcome ${detail.summary.status}`} aria-live="polite">
        <div>
          <p className="task-kicker">Execution summary</p>
          <h2>{detail.summary.title}</h2>
          <p>{detail.summary.detail}</p>
        </div>
        <div className="task-outcome-stats">
          <strong>{detail.summary.completedEvents}</strong>
          <span>successful steps</span>
          {detail.summary.firstFailure ? (
            <span className="task-outcome-failure">First failure: {detail.summary.firstFailure.title}</span>
          ) : null}
        </div>
      </section>

      {task.errorCode ? (
        <div className="notice error task-error-notice" role="alert">
          <strong>{task.errorCode}</strong>: {task.errorSummary ?? "Task execution failed."}
        </div>
      ) : null}

      {task.status === "FAILED" && detail.diagnostic ? <ExecutionFailureDetails diagnostic={detail.diagnostic} /> : null}

      <section className="task-log-section">
        <div className="task-history-heading">
          <div>
            <p className="task-kicker">What happened</p>
            <h2>Execution history</h2>
          </div>
          <span>{detail.timeline.length} steps · {logs.length} output entries</span>
        </div>
        {detail.timeline.length === 0 ? (
          <div className="task-history-empty">Waiting for the worker to emit its first event...</div>
        ) : (
          <ol className="task-execution-timeline">
            {detail.timeline.map((entry) => (
              <li key={entry.id} className={`task-execution-event ${entry.status}`}>
                <span className="task-execution-marker" aria-hidden="true" />
                <div className="task-execution-content">
                  <div className="task-execution-heading">
                    <span className={`task-event-kind ${entry.kind}`}>{timelineKindLabel(entry.kind)}</span>
                    <strong>{entry.title}</strong>
                    <span className={`task-event-status ${entry.status}`}>{timelineStatusLabel(entry.status)}</span>
                  </div>
                  <time dateTime={entry.occurredAt}>{formatInstant(entry.occurredAt)}</time>
                  {entry.detail ? <p>{entry.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="task-log-section">
        <details className="task-raw-logs">
          <summary>Show raw output ({logs.length} entries)</summary>
          <div className="task-terminal" aria-live="polite">
            {logs.length === 0 ? (
              <p>No raw output has been recorded yet.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={`task-log-line ${log.stream}`}>
                  <time>{formatInstant(log.occurredAt)}</time>
                  <span>{log.stream}</span>
                  <code>{log.message}</code>
                </div>
              ))
            )}
          </div>
        </details>
      </section>
    </Shell>
  );
}

function timelineKindLabel(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    task: "Task",
    setup: "Setup",
    agent: "Codex",
    command: "Command",
    test: "Checks",
    git: "Git",
    github: "GitHub",
    error: "Error",
  };
  return labels[kind] ?? "Event";
}

function timelineStatusLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    pending: "pending",
    running: "in progress",
    success: "passed",
    warning: "warning",
    failed: "failed",
    cancelled: "cancelled",
    info: "info",
  };
  return labels[status] ?? status;
}
