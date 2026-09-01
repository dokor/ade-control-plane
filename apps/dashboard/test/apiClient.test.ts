import assert from "node:assert/strict";
import test from "node:test";

import {
  DashboardApiError,
  dashboardErrorMessage,
  requestDashboardJson,
} from "../src/lib/apiClient.js";

test("uses same-origin credentials and parses successful JSON responses", { concurrency: false }, async () => {
  const previousFetch = globalThis.fetch;
  const previousInfo = console.info;
  let receivedInit: RequestInit | undefined;
  const logs: string[] = [];
  globalThis.fetch = async (_input, init) => {
    receivedInit = init;
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  console.info = (...args: unknown[]) => logs.push(args.join(" "));

  try {
    assert.deepEqual(
      await requestDashboardJson<{ status: string }>("/api/github/issues?projectId=project&token=do-not-log"),
      { status: "ok" },
    );
    assert.equal(receivedInit?.credentials, "same-origin");
    assert.match(new Headers(receivedInit?.headers).get("x-dashboard-request-id") ?? "", /^[0-9a-f-]{36}$/iu);
    assert.equal(logs.length, 2);
    assert.match(logs[0] ?? "", /\/api\/github\/issues/);
    assert.doesNotMatch(logs.join("\n"), /do-not-log/);
  } finally {
    globalThis.fetch = previousFetch;
    console.info = previousInfo;
  }
});

test("turns sanitized BFF failures into a reusable client error", { concurrency: false }, async () => {
  const previousFetch = globalThis.fetch;
  const previousInfo = console.info;
  const previousWarn = console.warn;
  const logs: string[] = [];
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: "CSRF_REJECTED",
    summary: "The request origin does not match.",
    correlationId: "corr-97",
  }), { status: 403 });
  console.info = () => undefined;
  console.warn = (...args: unknown[]) => logs.push(args.join(" "));

  try {
    await assert.rejects(
      () => requestDashboardJson("/api/github/issues?token=github_pat_sensitive", {}, "Fallback"),
      (error: unknown) => {
        assert.ok(error instanceof DashboardApiError);
        assert.equal(error.code, "CSRF_REJECTED");
        assert.equal(error.correlationId, "corr-97");
        assert.equal(dashboardErrorMessage(error, "Fallback"), "CSRF_REJECTED: The request origin does not match.");
        return true;
      },
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? "", /CSRF_REJECTED/);
    assert.match(logs[0] ?? "", /corr-97/);
    assert.doesNotMatch(logs[0] ?? "", /github_pat_sensitive/);
  } finally {
    globalThis.fetch = previousFetch;
    console.info = previousInfo;
    console.warn = previousWarn;
  }
});

test("logs network failures without exposing the request URL", { concurrency: false }, async () => {
  const previousFetch = globalThis.fetch;
  const previousInfo = console.info;
  const previousWarn = console.warn;
  const logs: string[] = [];
  globalThis.fetch = async () => {
    throw new Error("network failure");
  };
  console.info = () => undefined;
  console.warn = (...args: unknown[]) => logs.push(args.join(" "));

  try {
    await assert.rejects(() => requestDashboardJson(
      "/api/github/issues?access_token=do-not-log",
    ));
    assert.match(logs[0] ?? "", /NETWORK_ERROR/);
    assert.match(logs[0] ?? "", /\/api\/github\/issues/);
    assert.doesNotMatch(logs[0] ?? "", /do-not-log/);
  } finally {
    globalThis.fetch = previousFetch;
    console.info = previousInfo;
    console.warn = previousWarn;
  }
});
