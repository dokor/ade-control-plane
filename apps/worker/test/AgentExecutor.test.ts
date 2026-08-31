import assert from "node:assert/strict";
import test from "node:test";

import { ClaudeCodeAgentExecutor, CodexAgentExecutor } from "../src/AgentExecutor.js";
import type { CommandInput, CommandResult, CommandRunner } from "../src/v0/CommandRunner.js";

class RecordingCommands implements CommandRunner {
  public input: CommandInput | null = null;

  public async run(input: CommandInput): Promise<CommandResult> {
    this.input = input;
    return { exitCode: 0, signal: null, stdout: "", stderr: "" };
  }
}

test("Codex and Claude adapters share the same stdin execution contract", async () => {
  for (const [Executor, executable, args] of [
    [CodexAgentExecutor, "codex", ["exec", "--sandbox", "workspace-write", "--ephemeral", "--json", "-"]],
    [ClaudeCodeAgentExecutor, "claude", ["--print", "--output-format", "json"]],
  ] as const) {
    const recorder = new RecordingCommands();
    const instance = new Executor({ commands: recorder, executable, environment: {} });
    await instance.execute({ prompt: "implement it", cwd: "C:/checkout" });
    assert.equal(recorder.input?.executable, executable);
    assert.deepEqual(recorder.input?.args, args);
    assert.equal(recorder.input?.stdin, "implement it");
  }
});
