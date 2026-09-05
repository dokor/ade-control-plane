import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const executorSource = new URL("../src/v0/V0TaskExecutor.ts", import.meta.url);

test("ADE initialization readiness is decoupled from issue delivery admission", async () => {
  const source = await readFile(executorSource, "utf8");
  const completeReadySetup = source.match(/const completeReadySetup = async[\s\S]*?executionStage\("Prepare ADE configuration"\);/u)?.[0] ?? "";

  assert.match(completeReadySetup, /recordAdeReadiness/u);
  assert.doesNotMatch(completeReadySetup, /resolveDeliveryPlan/u);
  assert.doesNotMatch(completeReadySetup, /ADE_DELIVERY_NOT_READY/u);
});

test("ADE setup changes use deterministic setup validation instead of issue readiness", async () => {
  const source = await readFile(executorSource, "utf8");

  assert.match(source, /deliveryPlan = initialization \? setupValidationPlan\(\)/u);
  assert.match(source, /reason: "Validate ADE setup changes without applying issue-readiness gates\."/u);
  assert.match(source, /initialization \? "Running ADE deterministic setup validation\."/u);
});
