import assert from "node:assert/strict";
import test from "node:test";

import { NodeCommandRunner } from "../src/v0/CommandRunner.js";

test("aborts the active process without invoking a shell", async () => {
  const abort = new AbortController();
  const runner = new NodeCommandRunner();
  const execution = runner.run({
    executable: process.execPath,
    args: [
      "-e",
      "console.log('ready'); setInterval(() => {}, 1000)",
    ],
    cwd: process.cwd(),
    signal: abort.signal,
    onOutput: ({ message }) => {
      if (message === "ready") abort.abort();
    },
  });

  await assert.rejects(execution, { name: "AbortError" });
});

test("bounds pending log persistence when child output bursts", async () => {
  const messages: string[] = [];
  let releaseLogs: () => void = () => undefined;
  const logGate = new Promise<void>((resolve) => { releaseLogs = resolve; });
  const releaseTimer = setTimeout(releaseLogs, 50);
  await new NodeCommandRunner().run({
    executable: process.execPath,
    // Produce enough output that the bounded queue is deterministically
    // saturated before the intentionally slow sink is released.
    args: ["-e", "for (let i = 0; i < 10000; i += 1) console.log(i)"],
    cwd: process.cwd(),
    onOutput: async ({ message }) => {
      await logGate;
      messages.push(message);
    },
  });
  clearTimeout(releaseTimer);

  assert.ok(messages.length < 10000);
  assert.match(messages.at(-1) ?? "", /output lines omitted/);
});
