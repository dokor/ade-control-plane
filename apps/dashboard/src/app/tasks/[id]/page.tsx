import Link from "next/link";
import { notFound } from "next/navigation";

import { Shell } from "../../../components/Shell.js";
import { TaskCancelButton } from "../../../components/TaskCancelButton.js";
import { TaskPrRetryButton } from "../../../components/TaskPrRetryButton.js";
import { requireAuthenticatedContext } from "../../../lib/auth.js";
import { formatInstant } from "../../../lib/format.js";
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
          : "Prompt libre"}</dd></div>
        <div><dt>Created</dt><dd>{formatInstant(task.createdAt)}</dd></div>
        <div><dt>Started</dt><dd>{formatInstant(task.startedAt)}</dd></div>
        <div><dt>Finished</dt><dd>{formatInstant(task.finishedAt)}</dd></div>
        <div><dt>Branch</dt><dd>{task.branchName ?? "not created yet"}</dd></div>
      </dl>

      {task.errorCode ? (
        <div className="notice error" role="alert">
          <strong>{task.errorCode}</strong>: {task.errorSummary ?? "Task execution failed."}
        </div>
      ) : null}

      <section className="task-log-section">
        <div className="task-history-heading">
          <div>
            <p className="task-kicker">Live execution record</p>
            <h2>Logs</h2>
          </div>
          <span>{logs.length} entries</span>
        </div>
        <div className="task-terminal" aria-live="polite">
          {logs.length === 0 ? (
            <p>Waiting for the worker to emit its first log entry...</p>
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
      </section>
    </Shell>
  );
}
