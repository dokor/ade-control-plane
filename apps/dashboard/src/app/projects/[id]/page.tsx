import Link from "next/link";
import { notFound } from "next/navigation";

import { ControlButton } from "../../../components/ControlButton.js";
import { PriorityForm } from "../../../components/PriorityForm.js";
import { Shell } from "../../../components/Shell.js";
import { requireAuthenticatedContext } from "../../../lib/auth.js";
import { formatAge, formatInstant } from "../../../lib/format.js";
import { getPersistence } from "../../../lib/persistence.js";
import { buildProjectDetail } from "../../../lib/readModel.js";
import { retryabilityExplanation } from "../../../lib/retry.js";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, config } = await requireAuthenticatedContext(`/projects/${id}`);
  const detail = await buildProjectDetail({
    persistence: await getPersistence(),
    quotaProvider: config.quotaProvider,
    quotaAccountRef: config.quotaAccountRef,
    projectId: id,
  });

  if (!detail) notFound();

  const { project, availableActions } = detail;
  const safeRetry = detail.executions.find(
    ({ id: executionId }) => executionId === availableActions.safeRetryExecutionId,
  );
  const latestExecution = detail.executions[0];

  return (
    <Shell
      title={project.name}
      actorRef={session.actorRef}
      refreshIntervalMs={config.refreshIntervalMs}
    >
      <p className="muted">
        <Link href="/">← Overview</Link>
      </p>

      <div className="cards">
        <article className="card">
          <h2>Control state</h2>
          <p className="value">
            <span className={`badge ${project.status}`}>{project.status}</span>
          </p>
          <p className="detail">
            {project.controlState} · priority {project.priority}
          </p>
          <p className="detail">
            <a href={project.repositoryUrl} rel="noreferrer noopener" target="_blank">
              {project.repositoryUrl.replace("https://github.com/", "")}
            </a>
          </p>
        </article>

        <article className="card">
          <h2>ADE snapshot</h2>
          <p className="value">{project.snapshotFresh ? "fresh" : "stale"}</p>
          <p className="detail">
            Observed {formatAge(project.snapshotAgeMs)} ({formatInstant(project.snapshotObservedAt)})
          </p>
          <p className="detail">
            Stage {project.stage ?? "unknown"} · {project.milestone ?? "no milestone"}
          </p>
        </article>

        <article className="card">
          <h2>Current work</h2>
          <p className="detail">{project.currentWorkSummary ?? "None reported by ADE."}</p>
          <h2>Next work</h2>
          <p className="detail">{project.nextWorkSummary ?? "None reported by ADE."}</p>
        </article>

        <article className="card">
          <h2>Waiting reason</h2>
          <p className="detail">{project.waitingReason ?? "Not waiting."}</p>
          {project.compatibleRunnerIds.length === 0 ? (
            <p className="detail">No compatible runner is currently online.</p>
          ) : null}
        </article>
      </div>

      <section>
        <h2>Controls</h2>
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
            variant="primary"
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
            disabled={!availableActions.canReprioritize}
          />
        </div>
      </section>

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
                <p className="detail">
                  Resolve from the linked issue or pull request with one of:
                </p>
                <ul className="detail">
                  {decision.githubCommands.map((command) => (
                    <li key={command}>
                      <code>{command}</code>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {detail.humanDecisions.length > 0 ? (
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

      <section>
        <h2>Executions</h2>
        {detail.executions.length === 0 ? (
          <p className="muted">No execution has been recorded for this project.</p>
        ) : (
          <div className="list">
            {detail.executions.slice(0, 10).map((execution) => (
              <article key={execution.id} className="panel">
                <div className="row">
                  <span>
                    <span className={`badge ${execution.status === "failed" ? "failed" : execution.status}`}>
                      {execution.status}
                    </span>{" "}
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
      </section>

      <section>
        <h2>Timeline</h2>
        {detail.timeline.length === 0 ? (
          <p className="muted">No persisted event yet.</p>
        ) : (
          <div className="timeline">
            {detail.timeline.slice(0, 40).map((entry) => (
              <div key={entry.id} className={`entry ${entry.severity}`}>
                <time>{formatInstant(entry.occurredAt)}</time>
                <div>
                  <strong>{entry.title}</strong>
                  {entry.detail ? <span className="muted"> — {entry.detail}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
