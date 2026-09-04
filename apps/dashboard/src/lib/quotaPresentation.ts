import type { QuotaState } from "@ade-control-plane/quota";

export type QuotaCapacityTone = "normal" | "warning" | "danger" | "unknown";

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
