"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
  const [value, setValue] = useState(String(priority));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const response = await fetch("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        type: "project.reprioritize",
        payload: { projectId, priority: Number(value) },
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const body = (await response.json()) as { summary?: string; code?: string };
    setMessage(response.ok ? (body.summary ?? "Applied.") : (body.code ?? "ERROR"));
    setPending(false);
    if (response.ok) router.refresh();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label htmlFor={`priority-${projectId}`}>Priority (0–100)</label>
      <input
        id={`priority-${projectId}`}
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
