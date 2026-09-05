import type { QuotaState } from "@ade-control-plane/quota";

export type QuotaCapacityTone = "normal" | "warning" | "danger" | "unknown";

export interface QuotaCapacityPresentationInput {
  state: QuotaState;
  usedPercent: number | null;
  snapshotAgeMs: number | null;
  refreshRequired: boolean;
  canStartWork: boolean;
  reason: string;
  staleAfterMs: number;
}

export interface QuotaCapacityPresentation {
  badgeStatus: string;
  badgeLabel: string;
  usageLabel: string;
  schedulingMessage: string;
  detailMessage: string;
}

export function quotaCapacityTone(state: QuotaState): QuotaCapacityTone {
  switch (state) {
    case "normal":
      return "normal";
    case "throttled":
    case "draining":
      return "warning";
    case "blocked":
      return "danger";
    case "unknown":
      return "unknown";
  }
}

export function quotaCapacityColor(state: QuotaState): string {
  switch (quotaCapacityTone(state)) {
    case "normal":
      return "var(--ok)";
    case "warning":
      return "var(--warn)";
    case "danger":
      return "var(--danger)";
    case "unknown":
      return "var(--muted)";
  }
}

export function presentQuotaCapacity(input: QuotaCapacityPresentationInput): QuotaCapacityPresentation {
  const usageLabel = input.usedPercent === null ? "Usage not reported" : `${Math.round(input.usedPercent)}% used`;
  const schedulingMessage = input.canStartWork ? "Quota permits new work." : "Quota does not permit new work.";
  const stale = input.state === "unknown"
    && input.refreshRequired
    && input.usedPercent !== null
    && input.snapshotAgeMs !== null
    && input.snapshotAgeMs >= input.staleAfterMs;

  if (stale) {
    return {
      badgeStatus: "stale",
      badgeLabel: "Stale",
      usageLabel: `${usageLabel} · last known`,
      schedulingMessage: "New work is paused until quota is refreshed.",
      detailMessage: `Last provider reading is ${formatMinutes(input.snapshotAgeMs!)} old; freshness limit is ${formatMinutes(input.staleAfterMs)}.`,
    };
  }

  const invalid = input.state === "unknown"
    && input.refreshRequired
    && input.usedPercent !== null
    && input.snapshotAgeMs === null;
  if (invalid) {
    return {
      badgeStatus: "invalid",
      badgeLabel: "Invalid data",
      usageLabel: `${usageLabel} · last known`,
      schedulingMessage: "New work is paused until quota data can be validated.",
      detailMessage: "The provider reading has an invalid timestamp. Refresh quota before starting new work.",
    };
  }

  if (input.state === "unknown" && input.usedPercent === null) {
    return {
      badgeStatus: "unknown",
      badgeLabel: "Unavailable",
      usageLabel,
      schedulingMessage: "New work is paused until quota usage is available.",
      detailMessage: input.reason,
    };
  }

  if (input.state === "unknown" && input.refreshRequired) {
    return {
      badgeStatus: "stale",
      badgeLabel: "Refresh required",
      usageLabel: input.usedPercent === null ? usageLabel : `${usageLabel} · last known`,
      schedulingMessage: "New work is paused until quota is refreshed.",
      detailMessage: input.reason,
    };
  }

  return {
    badgeStatus: input.state,
    badgeLabel: input.state === "normal" ? "Normal" : capitalize(input.state),
    usageLabel,
    schedulingMessage,
    detailMessage: input.reason,
  };
}

function formatMinutes(milliseconds: number): string {
  const minutes = Math.max(1, Math.floor(milliseconds / 60_000));
  return `${minutes} min`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
