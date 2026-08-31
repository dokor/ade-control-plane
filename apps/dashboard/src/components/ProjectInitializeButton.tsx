"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectInitializeButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function initialize(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/initialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      });
      const body = (await response.json().catch(() => ({}))) as {
        task?: { id?: string };
        code?: string;
        summary?: string;
      };
      if (!response.ok || !body.task?.id) {
        setError(`${body.code ?? "ERROR"}: ${body.summary ?? "Initialization could not be started."}`);
        return;
      }
      router.push(`/tasks/${body.task.id}`);
    } catch {
      setError("The Dashboard could not reach the initialization API.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <button className="button primary" type="button" onClick={initialize} disabled={pending}>
        {pending ? "Starting..." : "Initialize ADE"}
      </button>
      {error ? <span className="task-action-error"> {error}</span> : null}
    </span>
  );
}
