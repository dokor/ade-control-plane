export type QuotaState = "normal" | "throttled" | "draining" | "blocked" | "unknown";

export interface ProviderQuotaSnapshot {
  provider: string;
  accountRef: string;
  usedPercent: number | null;
  observedAt: string;
  windowDurationMins?: number;
  windowStartedAt?: string;
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
  const resetAt = snapshot.resetsAt === undefined ? undefined : Date.parse(snapshot.resetsAt);
  const stale = Number.isNaN(now) || Number.isNaN(observedAt) ||
    observedAt + policy.staleAfterMs <= now ||
    (expiresAt !== undefined && (Number.isNaN(expiresAt) || expiresAt <= now));
  // A provider reset time is only a hint to read the provider again. It is
  // never evidence that a new quota window is actually available.
  const resetRefreshRequired = resetAt !== undefined && !Number.isNaN(resetAt) && resetAt <= now;
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
  if (snapshot.usedPercent >= policy.blockedAtPercent) return blockedDecision("Provider quota is blocked.", reset, resetRefreshRequired);
  if (snapshot.usedPercent >= policy.drainingAtPercent) return quotaDecision("draining", "Provider quota is draining.", reset, resetRefreshRequired);
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

/**
 * Normalizes the stable Codex App Server account/rateLimits/read response.
 *
 * Codex can expose more than one active window. The control-plane policy is a
 * single hard gate, so the most constrained exposed window is selected. This
 * is deliberately based on the returned values, never on a model-to-bucket
 * assumption. The other window is retained only as bounded metadata.
 */
export function normalizeCodexRateLimits(input: {
  accountRef: string;
  response: unknown;
  observedAt: string;
  freshnessMs?: number;
}): ProviderQuotaSnapshot {
  const rateLimits = selectCodexRateLimits(input.response);
  const windows = rateLimits
    ? [
        readCodexWindow(rateLimits.primary, "primary"),
        readCodexWindow(rateLimits.secondary, "secondary"),
      ].filter((window): window is CodexWindow => window !== null)
    : [];
  const selected = [...windows].sort((left, right) => right.usedPercent - left.usedPercent)[0];
  const metadata: Record<string, string> = {
    source: "codex-app-server",
    ...(selected ? { selectedWindow: selected.name } : {}),
    ...(typeof rateLimits?.rateLimitReachedType === "string"
      ? { rateLimitReachedType: boundedMetadata(rateLimits.rateLimitReachedType) }
      : {}),
  };
  for (const window of windows) {
    metadata[`${window.name}UsedPercent`] = String(window.usedPercent);
  }

  const observedAtMs = Date.parse(input.observedAt);
  const expiresAt = input.freshnessMs !== undefined &&
      Number.isSafeInteger(input.freshnessMs) && input.freshnessMs > 0 &&
      !Number.isNaN(observedAtMs)
    ? new Date(observedAtMs + input.freshnessMs).toISOString()
    : undefined;

  return {
    provider: "openai",
    accountRef: input.accountRef,
    usedPercent: selected?.usedPercent ?? null,
    observedAt: input.observedAt,
    ...(selected?.windowDurationMins !== undefined
      ? { windowDurationMins: selected.windowDurationMins }
      : {}),
    ...(selected?.resetsAt ? { resetsAt: selected.resetsAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    metadata,
  };
}

export interface CodexAppServerWebSocket {
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: CodexWebSocketEvent) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: CodexWebSocketEvent) => void): void;
  send(data: string): void;
  close(): void;
}

export type CodexAppServerWebSocketFactory = (url: string) => CodexAppServerWebSocket;

export interface CodexWebSocketEvent {
  data?: unknown;
}

export interface CodexAppServerQuotaSourceOptions {
  url: string;
  accountRef: string;
  freshnessMs?: number;
  requestTimeoutMs?: number;
  now?(): Date;
  webSocketFactory?: CodexAppServerWebSocketFactory;
}

/** Reads the documented account/rateLimits/read JSON-RPC method from App Server. */
export class CodexAppServerQuotaSource {
  private readonly now: () => Date;
  private readonly webSocketFactory: CodexAppServerWebSocketFactory;

  public constructor(private readonly options: CodexAppServerQuotaSourceOptions) {
    this.now = options.now ?? (() => new Date());
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
  }

  public async read(): Promise<ProviderQuotaSnapshot> {
    const observedAt = this.now().toISOString();
    const timeoutMs = this.options.requestTimeoutMs ?? 5_000;
    const socket = this.webSocketFactory(this.options.url);

    return new Promise<ProviderQuotaSnapshot>((resolve, reject) => {
      let settled = false;
      let initialized = false;
      const timeout = setTimeout(() => fail("CODEX_QUOTA_TIMEOUT"), timeoutMs);
      timeout.unref?.();

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        try {
          socket.close();
        } catch {
          // The result of the quota read is already decided.
        }
        callback();
      };
      const fail = (code: string): void => {
        finish(() => reject(new Error(`Codex quota read failed (${code}).`)));
      };
      const send = (message: Readonly<Record<string, unknown>>): void => {
        try {
          socket.send(JSON.stringify(message));
        } catch {
          fail("CODEX_QUOTA_SEND_FAILED");
        }
      };
      const onOpen = (): void => {
        send({
          method: "initialize",
          id: 1,
          params: {
            clientInfo: {
              name: "ade-control-plane",
              title: "ADE Control Plane",
              version: "0.0.0",
            },
          },
        });
      };
      const onMessage = (event: CodexWebSocketEvent): void => {
        void handleMessage(event.data);
      };
      const onError = (): void => fail("CODEX_QUOTA_CONNECTION_FAILED");
      const onClose = (): void => fail("CODEX_QUOTA_CONNECTION_CLOSED");
      const handleMessage = async (data: unknown): Promise<void> => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readWebSocketText(data));
        } catch {
          fail("CODEX_QUOTA_INVALID_RESPONSE");
          return;
        }
        if (!isRecord(parsed)) {
          fail("CODEX_QUOTA_INVALID_RESPONSE");
          return;
        }
        if ("error" in parsed) {
          fail(initialized ? "CODEX_QUOTA_REQUEST_REJECTED" : "CODEX_QUOTA_INITIALIZE_REJECTED");
          return;
        }
        if (parsed.id === 1) {
          if (!isRecord(parsed.result)) {
            fail("CODEX_QUOTA_INITIALIZE_REJECTED");
            return;
          }
          initialized = true;
          send({ method: "initialized" });
          send({ method: "account/rateLimits/read", id: 2 });
          return;
        }
        if (parsed.id === 2) {
          finish(() => resolve(normalizeCodexRateLimits({
            accountRef: this.options.accountRef,
            response: parsed.result,
            observedAt,
            ...(this.options.freshnessMs !== undefined
              ? { freshnessMs: this.options.freshnessMs }
              : {}),
          })));
        }
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
  }
}

export interface QuotaSnapshotPersistence {
  append(input: {
    snapshot: ProviderQuotaSnapshot;
    policyState: QuotaState;
  }): Promise<void>;
  getLatest(provider: string, accountRef: string): Promise<ProviderQuotaSnapshot | null>;
  deleteOlderThan?(provider: string, accountRef: string, before: string): Promise<void>;
}

export interface QuotaRefreshResult {
  snapshot: ProviderQuotaSnapshot;
  decision: QuotaDecision;
  refreshed: boolean;
  errorCode?: "PROVIDER_QUOTA_UNAVAILABLE";
}

export interface QuotaPolicyTransition {
  from: QuotaState | null;
  to: QuotaState;
  observedAt: string;
  resetsAt?: string;
}

/**
 * Refreshes live quota only when the cached observation requires it, persists
 * successful observations, and falls back to the last observation on errors.
 */
export class QuotaRefreshCoordinator {
  private cached: ProviderQuotaSnapshot | null = null;
  private lastPolicyState: QuotaState | null = null;
  private readonly now: () => Date;

  public constructor(private readonly options: {
    provider: string;
    accountRef: string;
    source: Pick<CodexAppServerQuotaSource, "read">;
    persistence: QuotaSnapshotPersistence;
    policy?: QuotaPolicy | (() => Promise<QuotaPolicy>);
    retentionMs?: number;
    onPolicyTransition?(transition: QuotaPolicyTransition): Promise<void>;
    now?(): Date;
  }) {
    this.now = options.now ?? (() => new Date());
  }

  public async refresh(force = false): Promise<QuotaRefreshResult> {
    const asOf = this.now().toISOString();
    const policy = typeof this.options.policy === "function"
      ? await this.options.policy()
      : this.options.policy ?? DEFAULT_QUOTA_POLICY;
    if (!force && this.cached && !evaluateQuota(this.cached, policy, asOf).refreshRequired) {
      const decision = evaluateQuota(this.cached, policy, asOf);
      await this.recordTransition(decision);
      return {
        snapshot: this.cached,
        decision,
        refreshed: false,
      };
    }

    try {
      const snapshot = await this.options.source.read();
      const decision = evaluateQuota(snapshot, policy, asOf);
      await this.options.persistence.append({ snapshot, policyState: decision.state });
      const retentionMs = this.options.retentionMs ?? 30 * 24 * 60 * 60 * 1_000;
      if (this.options.persistence.deleteOlderThan && Number.isSafeInteger(retentionMs) && retentionMs > 0) {
        await this.options.persistence.deleteOlderThan(
          snapshot.provider,
          snapshot.accountRef,
          new Date(Date.parse(asOf) - retentionMs).toISOString(),
        );
      }
      this.cached = snapshot;
      await this.recordTransition(decision);
      return { snapshot, decision, refreshed: true };
    } catch {
      const snapshot = this.cached ?? await this.options.persistence.getLatest(
        this.options.provider,
        this.options.accountRef,
      ) ?? {
        provider: this.options.provider,
        accountRef: this.options.accountRef,
        usedPercent: null,
        observedAt: asOf,
      };
      const decision = evaluateQuota(snapshot, policy, asOf);
      await this.recordTransition(decision);
      return {
        snapshot,
        decision,
        refreshed: false,
        errorCode: "PROVIDER_QUOTA_UNAVAILABLE",
      };
    }
  }

  private async recordTransition(decision: QuotaDecision): Promise<void> {
    if (this.lastPolicyState === decision.state) return;
    const transition: QuotaPolicyTransition = {
      from: this.lastPolicyState,
      to: decision.state,
      observedAt: this.now().toISOString(),
      ...(decision.resetsAt ? { resetsAt: decision.resetsAt } : {}),
    };
    this.lastPolicyState = decision.state;
    await this.options.onPolicyTransition?.(transition);
  }
}

interface CodexWindow {
  name: "primary" | "secondary";
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: string;
}

function selectCodexRateLimits(response: unknown): Record<string, unknown> | null {
  if (!isRecord(response)) return null;
  const result = isRecord(response.result) ? response.result : response;
  const byLimitId = isRecord(result.rateLimitsByLimitId) ? result.rateLimitsByLimitId : null;
  if (byLimitId && isRecord(byLimitId.codex)) return byLimitId.codex;
  if (!isRecord(result.rateLimits)) return null;
  const limitId = result.rateLimits.limitId;
  return limitId === undefined || limitId === "codex" ? result.rateLimits : null;
}

function readCodexWindow(value: unknown, name: CodexWindow["name"]): CodexWindow | null {
  if (!isRecord(value)) return null;
  const usedPercent = value.usedPercent;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return null;
  }
  const windowDurationMins = value.windowDurationMins;
  const resetsAt = unixSecondsToIso(value.resetsAt);
  return {
    name,
    usedPercent,
    ...(typeof windowDurationMins === "number" && Number.isSafeInteger(windowDurationMins) && windowDurationMins > 0
      ? { windowDurationMins }
      : {}),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function unixSecondsToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return new Date(value * 1_000).toISOString();
}

function boundedMetadata(value: string): string {
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : "present";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readWebSocketText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (isRecord(data) && typeof data.text === "function") {
    const text = await data.text();
    if (typeof text === "string") return text;
  }
  throw new Error("Unsupported WebSocket message.");
}

function defaultWebSocketFactory(url: string): CodexAppServerWebSocket {
  const constructor = (globalThis as typeof globalThis & {
    WebSocket?: new (url: string) => CodexAppServerWebSocket;
  }).WebSocket;
  if (!constructor) throw new Error("WebSocket runtime is unavailable.");
  return new constructor(url);
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

function blockedDecision(reason: string, reset: { resetsAt?: string }, refreshRequired = false): QuotaDecision {
  return { state: "blocked", canStartWork: false, reason, refreshRequired, ...reset };
}

function quotaDecision(
  state: Exclude<QuotaState, "blocked" | "unknown">,
  reason: string,
  reset: { resetsAt?: string },
  refreshRequired = false,
): QuotaDecision {
  return { state, canStartWork: true, reason, refreshRequired, ...reset };
}
