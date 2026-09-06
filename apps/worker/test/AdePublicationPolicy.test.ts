import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../../../ade.config.json", import.meta.url);

test("ade-control-plane publishes reviewed PRs without a separate pre-publication approval", async () => {
  const config = JSON.parse(await readFile(configUrl, "utf8")) as {
    issueLifecycle?: { deliveryPlan?: { requireHumanApprovalBeforePublish?: boolean } };
  };

  assert.equal(
    config.issueLifecycle?.deliveryPlan?.requireHumanApprovalBeforePublish,
    false,
    "The Control Plane MVP expects ADE to create a reviewed PR automatically; merge remains human-controlled.",
  );
});
