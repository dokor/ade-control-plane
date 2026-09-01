import Link from "next/link";

import { Shell } from "../../components/Shell.js";
import { TaskCancelButton } from "../../components/TaskCancelButton.js";
import { TaskComposer } from "../../components/TaskComposer.js";
import { requireAuthenticatedContext } from "../../lib/auth.js";
import { formatHistoryDate, formatInstant } from "../../lib/format.js";
import { loadGithubRuntime } from "../../lib/githubRuntime.js";
import { getPersistence } from "../../lib/persistence.js";
import { buildTaskDashboard, safePullRequestUrl } from "../../lib/taskReadModel.js";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { session, config } = await requireAuthenticatedContext("/tasks");
  const github = await loadGithubRuntime();
  const dashboard = await buildTaskDashboard(await getPersistence(), github?.issueReader);

  return (
    <Shell
      title="Task runway"
      actorRef={session.actorRef}
      refreshIntervalMs={config.refreshIntervalMs}
    >
      <section className="task-hero">
        <div>
          <p className="task-kicker">Single worker / Codex / Human-reviewed PR</p>
          <h2>Turn one focused request into a reviewable change.</h2>
          <p>
            Pick a registered project, describe the outcome, then follow the branch,
            logs and pull request from here.
          </p>
        </div>
        <div className={`task-slot ${dashboard.activeTask ? "busy" : "available"}`}>
          <span className="task-slot-dot" aria-hidden="true" />
          <strong>{dashboard.activeTask ? "Execution slot busy" : "Execution slot ready"}</strong>
          <small>{dashboard.activeTask ? dashboard.activeTask.projectName : "One task at a time"}</small>
        </div>
      </section>

      <div className="task-workspace">
        <article className="task-compose-panel">
          <div className="task-panel-heading">
            <span>01</span>
            <div>
              <h2>Brief the worker</h2>
              <p>Prompts stay attached to the task and are never interpolated into a shell.</p>
            </div>
          </div>
          <TaskComposer
            projects={dashboard.projects}
            activeTaskId={dashboard.activeTask?.id ?? null}
          />
        </article>

        <aside className="task-active-panel">
          <div className="task-panel-heading">
            <span>02</span>
            <div>
              <h2>Active slot</h2>
              <p>Polling refreshes status and logs without holding a browser connection.</p>
            </div>
          </div>
          {dashboard.activeTask ? (
            <div className="task-active-body">
              <span className={`badge ${dashboard.activeTask.status.toLowerCase()}`}>
                {dashboard.activeTask.status}
              </span>
              <h3>{dashboard.activeTask.projectName}</h3>
              <p>{dashboard.activeTask.source.type === "github-issue"
                ? `GitHub issue #${dashboard.activeTask.source.issueNumber}`
                : dashboard.activeTask.source.type === "ade-initialize"
                  ? "Initialisation de la configuration ADE"
                  : dashboard.activeTask.prompt}</p>
              <dl className="task-meta">
                <div><dt>Created</dt><dd>{formatInstant(dashboard.activeTask.createdAt)}</dd></div>
                <div><dt>Repository</dt><dd>{dashboard.activeTask.repository}</dd></div>
              </dl>
              <div className="actions">
                <Link className="button task-open" href={`/tasks/${dashboard.activeTask.id}`}>
                  Open execution
                </Link>
                <TaskCancelButton
                  taskId={dashboard.activeTask.id}
                  status={dashboard.activeTask.status as "PENDING" | "RUNNING"}
                />
              </div>
            </div>
          ) : (
            <div className="task-empty-slot">
              <span>Ready</span>
              <p>The next submitted task will claim the global execution slot.</p>
            </div>
          )}
        </aside>
      </div>

      <section className="task-history-section">
        <div className="task-history-heading">
          <div>
            <p className="task-kicker">Recent delivery trail</p>
            <h2>Task history</h2>
          </div>
          <span>{dashboard.tasks.length} shown</span>
        </div>
        {dashboard.tasks.length === 0 ? (
          <div className="task-history-empty">No task has been submitted yet.</div>
        ) : (
          <div className="task-history">
            {dashboard.tasks.map((task) => {
              const pullRequestUrl = safePullRequestUrl(task.pullRequestUrl);
              return (
                <article key={task.id} className="task-history-row">
                  <div className="task-history-status">
                    <span className={`badge ${task.status.toLowerCase()}`}>{task.status}</span>
                    <time dateTime={task.createdAt} title={formatInstant(task.createdAt)}>{formatHistoryDate(task.createdAt)}</time>
                  </div>
                  <div className="task-history-main">
                    <span className="badge badge-neutral task-history-project">{task.projectName}</span>
                    <h3><Link href={`/tasks/${task.id}`}>{task.title}</Link></h3>
                    <p>{task.source.type === "github-issue"
                      ? `GitHub issue #${task.source.issueNumber}`
                      : task.source.type === "ade-initialize" ? "Initialisation ADE" : "Prompt libre"}</p>
                    <p className={`task-history-result ${task.status.toLowerCase()}`}>
                      {task.status === "SUCCESS"
                        ? task.pullRequestNumber ? `Completed successfully · PR #${task.pullRequestNumber}` : "Completed successfully"
                        : task.status === "FAILED"
                          ? `${task.errorCode ?? "Execution failed"}: ${task.errorSummary ?? "Review task details for the failure point."}`
                          : task.status === "CANCELLED"
                            ? "Cancelled before successful delivery"
                            : task.status === "RUNNING" ? "Execution in progress" : "Waiting for the worker"}
                    </p>
                    <small>{task.repository} / {task.id.slice(0, 8)}</small>
                  </div>
                  <div className="task-history-action">
                    {pullRequestUrl ? (
                      <a href={pullRequestUrl} target="_blank" rel="noreferrer noopener">PR #{task.pullRequestNumber}</a>
                    ) : (
                      <Link href={`/tasks/${task.id}`}>Details -&gt;</Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </Shell>
  );
}
