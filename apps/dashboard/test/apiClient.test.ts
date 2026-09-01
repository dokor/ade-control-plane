import assert from "node:assert/strict";
import test from "node:test";

import {
  DashboardApiError,
  dashboardErrorMessage,
  requestDashboardJson,
} from "../src/lib/apiClient.js";

test("uses same-origin credentials and parses successful JSON responses", async () => {
  const previousFetch = globalThis.fetch;
  let receivedInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedInit = init;
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    assert.deepEqual(await requestDashboardJson<{ status: string }>("/api/test"), { status: "ok" });
    assert.equal(receivedInit?.credentials, "same-origin");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("turns sanitized BFF failures into a reusable client error", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: "CSRF_REJECTED",
    summary: "The request origin does not match.",
    correlationId: "corr-97",
  }), { status: 403 });

  try {
    await assert.rejects(
      () => requestDashboardJson("/api/test", {}, "Fallback"),
      (error: unknown) => {
        assert.ok(error instanceof DashboardApiError);
        assert.equal(error.code, "CSRF_REJECTED");
        assert.equal(error.correlationId, "corr-97");
        assert.equal(dashboardErrorMessage(error, "Fallback"), "CSRF_REJECTED: The request origin does not match.");
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
