import assert from "node:assert/strict";
import test from "node:test";

import { parseCommand } from "../src/commandParser.js";

test("parses the supported vocabulary", () => {
  assert.deepEqual(parseCommand("@ade status"), { type: "status" });
  assert.deepEqual(parseCommand("@ade pause"), { type: "pause" });
  assert.deepEqual(parseCommand("@ade resume"), { type: "resume" });
  assert.deepEqual(parseCommand("@ade retry"), { type: "retry" });
  assert.deepEqual(parseCommand("@ade priority 80"), { type: "priority", priority: 80 });
  assert.deepEqual(parseCommand("@ade decide D42 option-a"), {
    type: "decide",
    decisionRef: "D42",
    option: "option-a",
  });
});

test("stays silent on ordinary discussion", () => {
  assert.equal(parseCommand("Looks good to me, shipping tomorrow."), null);
  assert.equal(parseCommand("thanks @ade-bot maintainers"), null);
  assert.equal(parseCommand(""), null);
});

test("ignores directives inside code fences and quotes", () => {
  assert.equal(parseCommand("```\n@ade pause\n```"), null);
  assert.equal(parseCommand("> @ade pause\n\nI would not do that."), null);
  assert.equal(parseCommand("~~~\n@ade priority 0\n~~~"), null);
});

test("takes the first directive only", () => {
  assert.deepEqual(parseCommand("@ade status\n@ade pause"), { type: "status" });
});

test("refuses unknown verbs instead of guessing", () => {
  assert.throws(() => parseCommand("@ade deploy"), /UNKNOWN_COMMAND/);
  assert.throws(() => parseCommand("@ade exec rm -rf /"), /UNKNOWN_COMMAND/);
});

test("validates arguments strictly", () => {
  assert.throws(() => parseCommand("@ade priority"), /INVALID_ARGUMENT/);
  assert.throws(() => parseCommand("@ade priority 900"), /INVALID_ARGUMENT/);
  assert.throws(() => parseCommand("@ade priority high"), /INVALID_ARGUMENT/);
  assert.throws(() => parseCommand("@ade decide D42"), /INVALID_ARGUMENT/);
  assert.throws(() => parseCommand("@ade decide ../../etc/passwd option-a"), /INVALID_ARGUMENT/);
  assert.throws(() => parseCommand("@ade decide D42 $(whoami)"), /INVALID_ARGUMENT/);
  assert.throws(() => parseCommand("@ade decide D42 a;rm -rf /"), /INVALID_ARGUMENT/);
});

test("survives hostile bodies without scanning unbounded input", () => {
  assert.equal(parseCommand("x".repeat(200_000)), null);
  assert.equal(parseCommand(`${"filler\n".repeat(500)}@ade pause`), null);
  assert.equal(parseCommand(`@ade ${"a".repeat(600)}`), null);
});

test("tolerates markdown emphasis around the directive", () => {
  assert.deepEqual(parseCommand("**@ade pause**"), { type: "pause" });
  assert.deepEqual(parseCommand("@ADE  Pause"), { type: "pause" });
});
