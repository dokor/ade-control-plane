"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";
import type { ProjectSetupReadiness } from "../lib/projectSetup.js";
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
  const [refreshing, startRefresh] = useTransition();
  const repairable = readiness.requirements.some((requirement) => requirement.repairable);
  const automaticRefreshSeconds = Math.max(5, Math.ceil(refreshIntervalMs / 1_000));

  async function prepare(): Promise<void> {
    setPending(true);
    setMessage(null);
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
      setMessage(`${labels}${body.result.pullRequestUrl ? "Setup PR opened; merge it, then refresh readiness. The page will also check automatically while it is open." : "Setup is up to date."}`);
      router.refresh();
    } catch (reason) {
      setMessage(dashboardErrorMessage(reason, "The Dashboard could not reach the setup API."));
    } finally {
      setPending(false);
    }
  }

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
        <button className="button primary" type="button" onClick={prepare} disabled={pending}>
          {pending ? "Preparing..." : readiness.ready ? "Prepare ADE" : "Prepare repository setup"}
        </button>
        <span className="muted">Repository changes remain reviewable; when the repository is ready, this action starts ADE initialization.</span>
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
      {message ? <p className="detail">{message}</p> : null}
    </section>
  );
}
