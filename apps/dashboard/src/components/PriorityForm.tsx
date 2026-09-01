"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";
import { ProjectPriorityHelp } from "./ProjectPriorityHelp.js";

export function PriorityForm({
  projectId,
  priority,
  disabled,
}: {
  projectId: string;
  priority: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const helpId = `priority-help-${projectId}`;
  const [value, setValue] = useState(String(priority));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const body = await requestDashboardJson<{ summary?: string }>("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "project.reprioritize",
          payload: { projectId, priority: Number(value) },
          idempotencyKey: crypto.randomUUID(),
        }),
      }, "Priority could not be updated.");
      setMessage(body.summary ?? "Applied.");
      router.refresh();
    } catch (reason) {
      setMessage(dashboardErrorMessage(reason, "Priority could not be updated."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label htmlFor={`priority-${projectId}`}>Priority (0–100)</label>
      <ProjectPriorityHelp id={helpId} />
      <input
        id={`priority-${projectId}`}
        aria-describedby={helpId}
        type="number"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled}
      />
      <button type="submit" className="primary" disabled={disabled || pending}>
        {pending ? "…" : "Update priority"}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  );
}
