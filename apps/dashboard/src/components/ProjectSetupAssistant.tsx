"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";
import type { ProjectSetupReadiness } from "../lib/projectSetup.js";
import { projectSetupPhase } from "../lib/projectSetupPhase.js";
import { formatInstant } from "../lib/format.js";
import { ProjectSetupRequirementHelp } from "./ProjectSetupRequirementHelp.js";
import { StatusBadge } from "./StatusBadge.js";

export function ProjectSetupAssistant({
  projectId,
  readiness,
  refreshIntervalMs,
}: {
  projectId: string;
  readiness: ProjectSetupReadiness;
  refreshIntervalMs: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [setupPullRequestUrl, setSetupPullRequestUrl] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const phase = projectSetupPhase(readiness);
  const repairable = readiness.requirements.some((requirement) => requirement.repairable);
  const automaticRefreshSeconds = Math.max(5, Math.ceil(refreshIntervalMs / 1_000));

  async function prepare(): Promise<void> {
    setPending(true);
    setMessage(null);
    setSetupPullRequestUrl(null);
    try {
      const body = await requestDashboardJson<{
        result?: { labelsCreated?: readonly string[]; pullRequestUrl?: string | null; initializationTask?: { id: string } | null };
      }>(`/api/projects/${projectId}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare" }),
      }, "Setup could not be prepared.");
      if (!body.result) {
        setMessage("ERROR: Setup could not be prepared.");
        return;
      }
      const labels = body.result.labelsCreated?.length ? `Created labels: ${body.result.labelsCreated.join(", ")}. ` : "";
      if (body.result.initializationTask?.id) {
        router.push(`/tasks/${body.result.initializationTask.id}`);
        return;
      }
      setSetupPullRequestUrl(body.result.pullRequestUrl ?? null);
      setMessage(`${labels}${body.result.pullRequestUrl ? "Setup PR opened. Merge it, then refresh readiness; the page also checks automatically while it is open." : "Setup is up to date."}`);
      router.refresh();
    } catch (reason) {
      setMessage(dashboardErrorMessage(reason, "The Dashboard could not reach the setup API."));
    } finally {
      setPending(false);
    }
  }

  const actionLabel = phase === "repository" ? "Create setup PR" : phase === "initialization" ? "Start ADE initialization" : "ADE ready";
  const actionDetail = phase === "repository"
    ? "Step 1: create a reviewable PR with the missing ADE repository files. Merge it before continuing."
    : phase === "initialization"
      ? "Step 2: start a worker task that prepares and validates this project’s ADE configuration, including ade.config.json."
      : "All onboarding checks passed. Use Refresh checks to verify the latest repository state.";
  const processSteps: readonly { label: string; detail: string; state: "complete" | "current" | "pending" }[] = [
    { label: "Prepare repository", detail: "Create and merge the ADE setup PR.", state: phase === "repository" ? "current" : "complete" },
    { label: "Initialize ADE", detail: "Prepare and validate ade.config.json in a worker task.", state: phase === "initialization" ? "current" : phase === "repository" ? "pending" : "complete" },
    { label: "Ready for work", detail: "Runner capabilities are verified against the default branch.", state: phase === "ready" ? "complete" : "pending" },
  ];

  function refreshChecks(): void {
    startRefresh(() => router.refresh());
  }

  return (
    <section className="panel">
      <div className="row">
        <div>
          <h2>ADE setup</h2>
          <p className="detail">Server-side checks for project files, ADE compatibility and GitHub workflow setup.</p>
        </div>
        <StatusBadge status={readiness.ready ? "ready" : "setup-required"}>
          {readiness.ready ? "ready" : "setup required"}
        </StatusBadge>
      </div>
      <div className="setup-refresh-summary">
        <div>
          <strong>How checks are updated</strong>
          <p className="detail">Checks are performed live by the server against GitHub. The page refreshes them automatically every {automaticRefreshSeconds} seconds while this tab is visible.</p>
          <p className="muted">Last check: {formatInstant(readiness.checkedAt)}</p>
        </div>
        <button type="button" className="button" onClick={refreshChecks} disabled={refreshing || pending}>
          {refreshing ? "Refreshing..." : "Refresh checks"}
        </button>
      </div>
      <div className="setup-process" aria-label="ADE onboarding process">
        {processSteps.map((step, index) => (
          <div className={`setup-process-step ${step.state}`} key={step.label}>
            <span className="setup-process-index" aria-hidden="true">{step.state === "complete" ? "✓" : index + 1}</span>
            <span className="setup-process-copy"><strong>{step.label}</strong><span className="muted">{step.detail}</span></span>
          </div>
        ))}
      </div>
      <div className="list">
        {readiness.requirements.map((requirement) => (
          <div className="row setup-requirement" key={requirement.key}>
            <span className="setup-requirement-copy">
              <span className="setup-requirement-label">
                <strong>{requirement.label}</strong>
                <ProjectSetupRequirementHelp requirement={requirement} />
              </span>
              <span className="muted">{requirement.detail}</span>
            </span>
            <StatusBadge status={requirement.state} />
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="button primary" type="button" onClick={prepare} disabled={pending || phase === "ready"}>
          {pending ? "Preparing..." : actionLabel}
        </button>
        <span className="muted">{actionDetail}</span>
      </div>
      {repairable ? (
        <div className="actions">
          <span className="muted">Missing labels are created directly; repository files are proposed in a reviewable PR.</span>
        </div>
      ) : null}
      {repairable ? (
        <p className="detail">
          Planned files: {readiness.plannedFiles.join(", ") || "none"}<br />
          Planned labels: {readiness.missingLabels.map(({ name }) => name).join(", ") || "none"}<br />
          Existing invalid files are preserved and require manual correction.
        </p>
      ) : null}
      {setupPullRequestUrl ? (
        <p className="detail"><a href={setupPullRequestUrl} rel="noreferrer noopener" target="_blank">Open the setup PR</a> to review and merge the proposed repository changes.</p>
      ) : null}
      {message ? <p className="detail">{message}</p> : null}
    </section>
  );
}
