"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ControlButtonProps {
  type: string;
  payload?: Record<string, unknown>;
  label: string;
  /** Sensitive actions require an explicit confirmation before submission. */
  confirm?: string;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  disabledReason?: string;
}

interface ControlResponse {
  summary?: string;
  code?: string;
  correlationId?: string;
}

export function ControlButton({
  type,
  payload = {},
  label,
  confirm,
  variant = "default",
  disabled = false,
  disabledReason,
}: ControlButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (confirm && !window.confirm(confirm)) return;

    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ type, payload, idempotencyKey: crypto.randomUUID() }),
      });
      const body = (await response.json()) as ControlResponse;
      setMessage(
        response.ok
          ? (body.summary ?? "Command applied.")
          : `${body.code ?? "ERROR"} — ${body.correlationId ?? ""}`,
      );
      if (response.ok) router.refresh();
    } catch {
      setMessage("The command could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        className={variant === "default" ? undefined : variant}
        onClick={submit}
        disabled={disabled || pending}
        title={disabled ? disabledReason : undefined}
      >
        {pending ? "…" : label}
      </button>
      {message ? <span className="muted"> {message}</span> : null}
    </span>
  );
}
