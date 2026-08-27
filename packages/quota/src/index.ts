export type QuotaState = "normal" | "throttled" | "draining" | "blocked" | "unknown";

export interface ProviderQuotaSnapshot {
  provider: string;
  accountRef: string;
  usedPercent: number | null;
  observedAt: string;
  expiresAt?: string;
  resetsAt?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface QuotaPolicy {
  throttledAtPercent: number;
  drainingAtPercent: number;
  blockedAtPercent: number;
  staleAfterMs: number;
  allowStartWhenUnknown: boolean;
}

export const DEFAULT_QUOTA_POLICY: QuotaPolicy = {
  throttledAtPercent: 70,
  drainingAtPercent: 85,
  blockedAtPercent: 95,
  staleAfterMs: 300_000,
  allowStartWhenUnknown: false,
};

export interface QuotaDecision {
  state: QuotaState;
  canStartWork: boolean;
  reason: string;
  resetsAt?: string;
  refreshRequired: boolean;
}

export function evaluateQuota(
  snapshot: ProviderQuotaSnapshot,
  policy: QuotaPolicy = DEFAULT_QUOTA_POLICY,
  asOf = new Date().toISOString(),
): QuotaDecision {
  const now = Date.parse(asOf);
  const observedAt = Date.parse(snapshot.observedAt);
  const expiresAt = snapshot.expiresAt === undefined ? undefined : Date.parse(snapshot.expiresAt);
  const stale = Number.isNaN(now) || Number.isNaN(observedAt) ||
    observedAt + policy.staleAfterMs <= now ||
    (expiresAt !== undefined && (Number.isNaN(expiresAt) || expiresAt <= now));
  const reset = snapshot.resetsAt === undefined ? {} : { resetsAt: snapshot.resetsAt };

  if (snapshot.usedPercent === null || stale) {
    return {
      state: "unknown",
      canStartWork: policy.allowStartWhenUnknown,
      reason: snapshot.usedPercent === null
        ? "Provider quota usage is unavailable."
        : "Provider quota snapshot is stale or invalid.",
      refreshRequired: true,
      ...reset,
    };
  }
  if (snapshot.usedPercent >= policy.blockedAtPercent) return blockedDecision("Provider quota is blocked.", reset);
  if (snapshot.usedPercent >= policy.drainingAtPercent) return quotaDecision("draining", "Provider quota is draining.", reset);
  if (snapshot.usedPercent >= policy.throttledAtPercent) return quotaDecision("throttled", "Provider quota is throttled.", reset);
  return quotaDecision("normal", "Provider quota allows normal scheduling.", reset);
}

export interface HeaderReader {
  get(name: string): string | null;
}

export function normalizeOpenAiRateLimitHeaders(input: {
  accountRef: string;
  headers: HeaderReader;
  observedAt: string;
}): ProviderQuotaSnapshot {
  const limit = readNumber(input.headers, "x-ratelimit-limit-tokens");
  const remaining = readNumber(input.headers, "x-ratelimit-remaining-tokens");
  const resetSeconds = parseResetSeconds(input.headers.get("x-ratelimit-reset-tokens"));
  const observedAt = Date.parse(input.observedAt);
  const resetsAt = resetSeconds === null || Number.isNaN(observedAt)
    ? undefined
    : new Date(observedAt + resetSeconds * 1000).toISOString();

  return {
    provider: "openai",
    accountRef: input.accountRef,
    usedPercent: limit !== null && remaining !== null && limit > 0
      ? Math.min(100, Math.max(0, ((limit - remaining) / limit) * 100))
      : null,
    observedAt: input.observedAt,
    ...(resetsAt ? { resetsAt } : {}),
    metadata: { bucket: "tokens", source: "rate-limit-headers" },
  };
}

function readNumber(headers: HeaderReader, name: string): number | null {
  const value = headers.get(name);
  return value !== null && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}

function parseResetSeconds(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function blockedDecision(reason: string, reset: { resetsAt?: string }): QuotaDecision {
  return { state: "blocked", canStartWork: false, reason, refreshRequired: false, ...reset };
}

function quotaDecision(
  state: Exclude<QuotaState, "blocked" | "unknown">,
  reason: string,
  reset: { resetsAt?: string },
): QuotaDecision {
  return { state, canStartWork: true, reason, refreshRequired: false, ...reset };
}
