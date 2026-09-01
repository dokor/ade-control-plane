"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";

export function ProjectDeleteButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function remove(): Promise<void> {
    const confirmationName = window.prompt(`This permanently removes local ADE data and the managed clone. Type ${projectName} to continue.`);
    if (confirmationName === null) return;
    setPending(true);
    setMessage(null);
    try {
      await requestDashboardJson(
        `/api/projects/${projectId}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmationName }) },
        "Project deletion was refused.",
      );
      router.push("/");
      router.refresh();
    } catch (reason) {
      setMessage(dashboardErrorMessage(reason, "Project deletion was refused."));
    } finally {
      setPending(false);
    }
  }
  return (
    <span>
      <button type="button" className="danger" onClick={remove} disabled={pending}>
        {pending ? "Queuing deletion…" : "Delete project"}
      </button>
      {message ? <span className="task-action-error" role="alert"> {message}</span> : null}
    </span>
  );
}
