"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";

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
      const body = await requestDashboardJson<ControlResponse>("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, payload, idempotencyKey: crypto.randomUUID() }),
      }, "The command could not be sent.");
      setMessage(body.summary ?? "Command applied.");
      router.refresh();
    } catch (reason) {
      setMessage(dashboardErrorMessage(reason, "The command could not be sent."));
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
