"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

export function TaskPrRetryButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    if (!window.confirm("Retry GitHub pull request creation only? The agent will not run again.")) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/retry-pr`, { method: "POST", credentials: "same-origin" });
      const body = await response.json() as { code?: string; summary?: string };
      if (!response.ok) {
        setError(`${body.code ?? "ERROR"}: ${body.summary ?? "PR retry failed."}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("The PR retry request could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return <div className="task-stop-control"><button type="button" onClick={retry} disabled={pending}>{pending ? "Requesting PR retry..." : "Retry PR only"}</button>{error ? <span className="task-action-error" role="alert">{error}</span> : null}</div>;
}
