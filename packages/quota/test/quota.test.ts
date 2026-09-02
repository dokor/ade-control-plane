import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexAppServerQuotaSource,
  evaluateQuota,
  normalizeCodexRateLimits,
  normalizeOpenAiRateLimitHeaders,
  QuotaRefreshCoordinator,
  type CodexAppServerWebSocket,
  type ProviderQuotaSnapshot,
} from "../src/index.js";

const at = "2026-08-27T08:00:00.000Z";
const snapshot = (usedPercent: number | null): ProviderQuotaSnapshot => ({
  accountRef: "codex",
  observedAt: at,
  provider: "openai",
  usedPercent,
});

test("applies quota thresholds and fails closed", () => {
  assert.equal(evaluateQuota(snapshot(70), undefined, at).state, "throttled");
  assert.equal(evaluateQuota(snapshot(85), undefined, at).state, "draining");
  assert.equal(evaluateQuota(snapshot(95), undefined, at).canStartWork, false);
  assert.equal(evaluateQuota(snapshot(null), undefined, at).canStartWork, false);
});

test("a passed reset time requests a fresh provider read without allowing work", () => {
  const at = "2026-08-28T12:00:00.000Z";
  const decision = evaluateQuota({ ...snapshot(100), observedAt: "2026-08-28T11:58:00.000Z", resetsAt: "2026-08-28T11:59:00.000Z" }, undefined, at);
  assert.equal(decision.state, "blocked");
  assert.equal(decision.canStartWork, false);
  assert.equal(decision.refreshRequired, true);
});

test("normalizes OpenAI headers without inventing missing usage", () => {
  const headers = new Map([
    ["x-ratelimit-limit-tokens", "1000"],
    ["x-ratelimit-remaining-tokens", "250"],
    ["x-ratelimit-reset-tokens", "1m30s"],
  ]);
  const normalized = normalizeOpenAiRateLimitHeaders({
    accountRef: "codex",
    headers: { get: (name) => headers.get(name) ?? null },
    observedAt: at,
  });

  assert.equal(normalized.usedPercent, 75);
  assert.equal(normalized.resetsAt, "2026-08-27T08:01:30.000Z");
  assert.equal(evaluateQuota(normalized, undefined, at).state, "throttled");
});

test("normalizes the documented Codex App Server response and selects the constrained window", () => {
  const normalized = normalizeCodexRateLimits({
    accountRef: "codex-account-main",
    observedAt: at,
    freshnessMs: 300_000,
    response: {
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1730947200 },
          secondary: { usedPercent: 95, windowDurationMins: 10080, resetsAt: 1731542400 },
          rateLimitReachedType: "weekly",
        },
      },
    },
  });

  assert.equal(normalized.usedPercent, 95);
  assert.equal(normalized.windowDurationMins, 10080);
  assert.equal(normalized.resetsAt, "2024-11-14T00:00:00.000Z");
  assert.equal(normalized.expiresAt, "2026-08-27T08:05:00.000Z");
  assert.equal(normalized.metadata?.selectedWindow, "secondary");
  assert.equal(evaluateQuota(normalized, undefined, at).state, "blocked");
});

test("uses the legacy rateLimits fallback only for the Codex bucket", () => {
  const fallback = normalizeCodexRateLimits({
    accountRef: "codex",
    observedAt: at,
    response: {
      rateLimits: {
        primary: { usedPercent: 40 },
        limitId: "codex",
      },
    },
  });
  const otherBucket = normalizeCodexRateLimits({
    accountRef: "codex",
    observedAt: at,
    response: {
      rateLimits: {
        primary: { usedPercent: 99 },
        limitId: "other",
      },
    },
  });

  assert.equal(fallback.usedPercent, 40);
  assert.equal(otherBucket.usedPercent, null);
});

test("does not invent a percentage or reset when Codex omits them", () => {
  const normalized = normalizeCodexRateLimits({
    accountRef: "codex",
    observedAt: at,
    response: { rateLimitsByLimitId: { codex: { primary: {} } } },
  });

  assert.equal(normalized.usedPercent, null);
  assert.equal(normalized.resetsAt, undefined);
  assert.equal(normalized.windowDurationMins, undefined);
});

test("reads account/rateLimits/read through App Server JSON-RPC", async () => {
  const socket = new FakeWebSocket();
  const source = new CodexAppServerQuotaSource({
    accountRef: "codex",
    url: "ws://127.0.0.1:4500",
    now: () => new Date(at),
    webSocketFactory: () => socket,
  });

  const result = source.read();
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0] ?? "{}"), {
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
  socket.message(JSON.stringify({ id: 1, result: {} }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(socket.sent[2] ?? "{}"), {
    method: "account/rateLimits/read",
    id: 2,
  });
  socket.message(JSON.stringify({
    id: 2,
    result: { rateLimits: { primary: { usedPercent: 71, resetsAt: 1730947200 } } },
  }));

  assert.equal((await result).usedPercent, 71);
});

test("sanitizes App Server errors", async () => {
  const socket = new FakeWebSocket();
  const source = new CodexAppServerQuotaSource({
    accountRef: "codex",
    url: "ws://127.0.0.1:4500",
    webSocketFactory: () => socket,
  });
  const result = source.read();
  socket.open();
  socket.message(JSON.stringify({ id: 1, result: {} }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  socket.message(JSON.stringify({
    id: 2,
    error: { message: "Bearer secret-token must not escape" },
  }));

  await assert.rejects(result, (error: unknown) => {
    const message = String(error);
    return message.includes("CODEX_QUOTA_REQUEST_REJECTED") && !message.includes("secret-token");
  });
});

test("reuses a fresh snapshot and falls back to persisted quota on read failure", async () => {
  let reads = 0;
  const stored = snapshot(72);
  const coordinator = new QuotaRefreshCoordinator({
    accountRef: "codex",
    provider: "openai",
    source: {
      read: async () => {
        reads += 1;
        if (reads === 1) return { ...stored, expiresAt: "2026-08-27T08:05:00.000Z" };
        throw new Error("provider payload must not escape");
      },
    },
    persistence: {
      append: async () => undefined,
      getLatest: async () => stored,
    },
    now: () => new Date(at),
  });

  const first = await coordinator.refresh();
  assert.equal(first.decision.state, "throttled");
  assert.equal(first.refreshed, true);
  const second = await coordinator.refresh();
  assert.equal(second.refreshed, false);
  assert.equal(reads, 1);
});

test("fails closed for invalid observations and empty reset headers", () => {
  const invalid = { ...snapshot(10), observedAt: "not-a-date" };
  assert.equal(evaluateQuota(invalid, undefined, at).state, "unknown");
  const normalized = normalizeOpenAiRateLimitHeaders({
    accountRef: "codex",
    headers: { get: (name) => name === "x-ratelimit-reset-tokens" ? "" : null },
    observedAt: at,
  });
  assert.equal(normalized.resetsAt, undefined);
});

class FakeWebSocket implements CodexAppServerWebSocket {
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

  public addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {}

  public open(): void {
    this.emit("open");
  }

  public message(data: unknown): void {
    this.emit("message", { data });
  }

  private emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
