export type QuotaState = "normal" | "throttled" | "draining" | "blocked";

export interface ProviderQuotaSnapshot {
  provider: string;
  accountId: string;
  usedPercent: number;
  capturedAt: string;
  resetsAt?: string;
  windowDurationMinutes?: number;
}

export interface QuotaPolicyThresholds {
  throttledAtPercent: number;
  drainingAtPercent: number;
  blockedAtPercent: number;
}

export const DEFAULT_QUOTA_THRESHOLDS: QuotaPolicyThresholds = {
  throttledAtPercent: 70,
  drainingAtPercent: 85,
  blockedAtPercent: 95,
};

export interface QuotaDecision {
  state: QuotaState;
  canStartWork: boolean;
  reason: string;
  resetsAt?: string;
}

export function evaluateQuota(
  snapshot: ProviderQuotaSnapshot,
  thresholds: QuotaPolicyThresholds = DEFAULT_QUOTA_THRESHOLDS,
): QuotaDecision {
  const { usedPercent } = snapshot;

  if (usedPercent >= thresholds.blockedAtPercent) {
    return {
      state: "blocked",
      canStartWork: false,
      reason: `Provider quota usage is ${usedPercent}%, at or above the ${thresholds.blockedAtPercent}% blocking threshold.`,
      ...(snapshot.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
    };
  }

  if (usedPercent >= thresholds.drainingAtPercent) {
    return {
      state: "draining",
      canStartWork: true,
      reason: `Provider quota usage is ${usedPercent}%; only short or high-priority work should start.`,
      ...(snapshot.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
    };
  }

  if (usedPercent >= thresholds.throttledAtPercent) {
    return {
      state: "throttled",
      canStartWork: true,
      reason: `Provider quota usage is ${usedPercent}%; concurrency should be reduced.`,
      ...(snapshot.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
    };
  }

  return {
    state: "normal",
    canStartWork: true,
    reason: `Provider quota usage is ${usedPercent}%; normal scheduling is allowed.`,
    ...(snapshot.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
  };
}
