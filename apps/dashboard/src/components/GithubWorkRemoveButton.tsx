"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";
import { DISCARD_UNCONFIRMED_GITHUB_WORK_CONFIRMATION, REMOVE_GITHUB_WORK_CONFIRMATION } from "../lib/githubWorkRemoval.js";

export function GithubWorkRemoveButton({ projectId, issueNumber, workId }: { projectId: string; issueNumber: number; workId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function remove(discardUnconfirmed = false) {
    if (!window.confirm(discardUnconfirmed ? DISCARD_UNCONFIRMED_GITHUB_WORK_CONFIRMATION : REMOVE_GITHUB_WORK_CONFIRMATION)) return;
    setPending(true); setMessage(null);
    try {
      await requestDashboardJson(`/api/tasks/github/${projectId}/${issueNumber}`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ workId, confirmed: true, discardUnconfirmed }),
      }, "Work removal was refused.");
      router.push("/tasks"); router.refresh();
    } catch (error) { setMessage(dashboardErrorMessage(error, "Work removal failed.")); }
    finally { setPending(false); }
  }
  return <div><button type="button" className="danger" onClick={() => void remove()} disabled={pending}>
    {pending ? "Removing…" : "Remove work item"}</button>
    <details className="task-remove-unconfirmed">
      <summary>Discard an unreconciled work item</summary>
      <p>Use only when the execution was handled elsewhere and no worker is still active. GitHub is preserved; the unknown Control Plane outcome stays auditable.</p>
      <button type="button" className="danger" onClick={() => void remove(true)} disabled={pending}>
        {pending ? "Removing…" : "Discard unreconciled work"}
      </button>
    </details>
    {message ? <p role="alert" className="task-action-error">{message}</p> : null}</div>;
}
