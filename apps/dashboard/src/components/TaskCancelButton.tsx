"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

interface CancelResponse {
  code?: string;
  summary?: string;
}

export function TaskCancelButton({
  taskId,
  status,
}: {
  taskId: string;
  status: "PENDING" | "RUNNING";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm(status === "RUNNING" ? "Stop the active Codex process?" : "Cancel this queued task?")) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await response.json()) as CancelResponse;
      if (!response.ok) {
        setError(`${body.code ?? "ERROR"}: ${body.summary ?? "Cancellation failed."}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("The cancellation request could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="task-stop-control">
      <button type="button" className="danger" onClick={cancel} disabled={pending}>
        {pending ? "Requesting stop..." : status === "RUNNING" ? "Stop Codex" : "Cancel task"}
      </button>
      {error ? <span className="task-action-error" role="alert">{error}</span> : null}
    </div>
  );
}
