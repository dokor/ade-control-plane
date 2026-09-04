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
  const persistence = await getPersistence();
  const projectRecord = await persistence.projects.getById(id);
  const detail = await buildProjectDetail({
    persistence,
    quotaProvider: config.quotaProvider,
    quotaAccountRef: config.quotaAccountRef,
    projectId: id,
    adeRuntimeVersion: config.adeRuntimeVersion,
  });

  if (!detail || !projectRecord) notFound();

  const setupReadiness = await inspectProjectSetup(
    projectRecord,
    await loadGithubRuntime(),
    undefined,
    await persistence.githubWork.getProfile(projectRecord.id),
  );

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

      <ProjectSetupAssistant project={project} work={detail.work} readiness={setupReadiness} refreshIntervalMs={config.refreshIntervalMs} />

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
                </div>
              </div>
            ))}
          </div>
        )}
      </details>
      <details className="panel project-disclosure">
        <summary>Danger zone</summary>
        <p className="detail">This permanently removes the managed local checkout and all ADE Control Plane records. It never deletes the GitHub repository.</p>
        <ProjectDeleteButton projectId={project.id} projectName={project.name} />
      </details>
    </Shell>
  );
}
