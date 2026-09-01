"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";
import type { ProjectSetupReadiness } from "../lib/projectSetup.js";

export function ProjectSetupAssistant({
  projectId,
  readiness,
}: {
  projectId: string;
  readiness: ProjectSetupReadiness;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const repairable = readiness.requirements.some((requirement) => requirement.repairable);

  async function prepare(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const body = await requestDashboardJson<{
        result?: { labelsCreated?: readonly string[]; pullRequestUrl?: string | null };
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
      setMessage(`${labels}${body.result.pullRequestUrl ? "Setup PR opened; merge it, then refresh readiness." : "Setup is up to date."}`);
      router.refresh();
    } catch (reason) {
      setMessage(dashboardErrorMessage(reason, "The Dashboard could not reach the setup API."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel">
      <div className="row">
        <div>
          <h2>ADE setup</h2>
          <p className="detail">Server-side checks for project files, ADE compatibility and GitHub workflow setup.</p>
        </div>
        <span className={`badge ${readiness.ready ? "ok" : "warn"}`}>{readiness.ready ? "ready" : "setup required"}</span>
      </div>
      <div className="list">
        {readiness.requirements.map((requirement) => (
          <div className="row" key={requirement.key}>
            <span><strong>{requirement.label}</strong><br /><span className="muted">{requirement.detail}</span></span>
            <span className={`badge ${requirement.state}`}>{requirement.state}</span>
          </div>
        ))}
      </div>
      {repairable ? (
        <div className="actions">
          <button className="button primary" type="button" onClick={prepare} disabled={pending}>
            {pending ? "Preparing..." : "Prepare setup"}
          </button>
          <span className="muted">The plan above is applied only after this explicit action.</span>
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
      <p className="muted">Checked {new Date(readiness.checkedAt).toLocaleString()}</p>
    </section>
  );
}
