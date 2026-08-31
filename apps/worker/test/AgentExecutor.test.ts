import assert from "node:assert/strict";
import test from "node:test";

import { ClaudeCodeAgentExecutor, CodexAgentExecutor } from "../src/AgentExecutor.js";
import type { CommandInput, CommandResult, CommandRunner } from "../src/v0/CommandRunner.js";

class RecordingCommands implements CommandRunner {
  public input: CommandInput | null = null;
  public stdout = "";

  public async run(input: CommandInput): Promise<CommandResult> {
    this.input = input;
    return { exitCode: 0, signal: null, stdout: this.stdout, stderr: "" };
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

test("normalizes provider JSON usage without retaining the raw payload", async () => {
  const commands = new RecordingCommands();
  commands.stdout = JSON.stringify({
    type: "result",
    session_id: "session-123",
    model: "claude-sonnet",
    duration_ms: 1_250,
    duration_api_ms: 900,
    num_turns: 2,
    total_cost_usd: 1.42,
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  });
  const result = await new ClaudeCodeAgentExecutor({ commands, executable: "claude", environment: {} }).execute({ prompt: "secret prompt", cwd: "C:/checkout" });

  assert.deepEqual(result.usage, {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    providerDurationMs: 1_250,
    providerApiDurationMs: 900,
    turnCount: 2,
    costAmount: 1.42,
    costCurrency: "USD",
    costKind: "provider_reported",
    usageSource: "claude-code-json",
    providerExecutionRef: "session-123",
    model: "claude-sonnet",
  });
  assert.equal(JSON.stringify(result.usage).includes("secret prompt"), false);
});
