import React, { type ReactNode } from "react";

export type BadgeTone = "success" | "info" | "warning" | "danger" | "neutral";

const TONE_BY_STATUS: Readonly<Record<string, BadgeTone>> = {
  completed: "success",
  compatible: "success",
  fresh: "success",
  healthy: "success",
  idle: "success",
  normal: "success",
  ok: "success",
  ready: "success",
  running: "success",
  succeeded: "success",
  success: "success",

  dispatched: "info",
  leased: "info",
  pending: "info",
  queued: "info",
  validating: "info",

  degraded: "warning",
  "degraded-github": "warning",
  draining: "warning",
  optional: "neutral",
  initializing: "warning",
  missing: "warning",
  reconciling: "warning",
  "setup-required": "warning",
  stale: "warning",
  throttled: "warning",
  "upgrade-required": "warning",
  "waiting-human": "warning",
  "waiting-quota": "warning",
  "waiting-runner": "warning",
  warn: "warning",

  blocked: "danger",
  failed: "danger",
  incompatible: "danger",
  invalid: "danger",

  cancelled: "neutral",
  disabled: "neutral",
  offline: "neutral",
  paused: "neutral",
  unknown: "neutral",
};

export function StatusBadge({
  status,
  children,
}: {
  status: string;
  children?: ReactNode;
}) {
  const normalizedStatus = status.toLowerCase().replaceAll("_", "-");
  const tone = TONE_BY_STATUS[normalizedStatus] ?? "neutral";

  return (
    <span className={`badge badge-${tone}`}>
      {children ?? status}
    </span>
  );
}
