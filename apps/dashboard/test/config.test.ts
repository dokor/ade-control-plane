import { strict as assert } from "node:assert";
import test from "node:test";

import { loadDashboardConfig } from "../src/lib/config.js";

const requiredEnv = {
  NODE_ENV: "test" as const,
  DASHBOARD_PUBLIC_URL: "https://dashboard.example",
  DASHBOARD_SESSION_SECRET: "session-secret",
  DASHBOARD_PASSWORD_HASH: "password-hash",
};

test("defaults dashboard polling to five minutes", async () => {
  const config = await loadDashboardConfig(requiredEnv);

  assert.equal(config.refreshIntervalMs, 300_000);
});

test("keeps dashboard polling interval configurable", async () => {
  const config = await loadDashboardConfig({
    ...requiredEnv,
    DASHBOARD_REFRESH_SECONDS: "42",
  });

  assert.equal(config.refreshIntervalMs, 42_000);
});
