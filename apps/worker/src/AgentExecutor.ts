import type { CommandOutput, CommandResult, CommandRunner } from "./v0/CommandRunner.js";
import type { AgentUsageMetrics } from "@ade-control-plane/database";
import { observeCommand } from "./v0/ExecutionDiagnostics.js";

export type AgentProvider = "codex" | "claude-code";

export interface AgentExecutionRequest {
  prompt: string;
  cwd: string;
  signal?: AbortSignal;
  onOutput?(output: CommandOutput): void | Promise<void>;
}

export interface AgentExecutor {
  readonly provider: AgentProvider;
  readonly capabilities: readonly string[];
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}

export interface AgentExecutionResult extends CommandResult {
  usage?: AgentUsageMetrics;
}

export interface CommandAgentExecutorOptions {
  commands: CommandRunner;
  executable: string;
  environment: Readonly<Record<string, string>>;
}

abstract class CommandBackedAgentExecutor implements AgentExecutor {
  public abstract readonly provider: AgentProvider;
  public abstract readonly capabilities: readonly string[];

  public constructor(protected readonly options: CommandAgentExecutorOptions) {}

  public abstract commandArguments(): readonly string[];

  public async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const result = await observeCommand(this.options.commands, {
      executable: this.options.executable,
      args: this.commandArguments(),
      cwd: request.cwd,
      stdin: request.prompt,
      env: this.options.environment,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.onOutput ? { onOutput: request.onOutput } : {}),
    });
    const usage = parseAgentUsage(result.stdout, this.provider);
    return usage ? { ...result, usage } : result;
  }
}

function parseAgentUsage(stdout: string, provider: AgentProvider): AgentUsageMetrics | null {
  const objects: Record<string, unknown>[] = [];
  for (const line of stdout.split(/\r?\n/u).toReversed()) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) objects.push(parsed);
    } catch {
      // Providers may mix human-readable lines with JSON events.
    }
  }
  for (const object of objects) {
    const usage = isRecord(object.usage) ? object.usage : isRecord(object.tokenUsage) ? object.tokenUsage : object;
    const metrics: AgentUsageMetrics = {
      ...numberMetric(usage, "input_tokens", "inputTokens"),
      ...numberMetric(usage, "cached_input_tokens", "cachedInputTokens"),
      ...numberMetric(usage, "cache_creation_input_tokens", "cacheWriteInputTokens"),
      ...numberMetric(usage, "output_tokens", "outputTokens"),
      ...numberMetric(usage, "reasoning_output_tokens", "reasoningOutputTokens"),
      ...numberMetric(usage, "total_tokens", "totalTokens"),
      ...numberMetric(object, "duration_ms", "providerDurationMs"),
      ...numberMetric(object, "duration_api_ms", "providerApiDurationMs"),
      ...numberMetric(object, "num_turns", "turnCount"),
    };
    const model = stringMetric(object, "model") ?? stringMetric(usage, "model");
    const providerExecutionRef = stringMetric(object, "session_id") ?? stringMetric(object, "thread_id");
    const costAmount = object.total_cost_usd;
    if (typeof costAmount === "number" && Number.isFinite(costAmount) && costAmount >= 0) metrics.costAmount = costAmount;
    if (model) metrics.model = model.slice(0, 200);
    if (providerExecutionRef) metrics.providerExecutionRef = providerExecutionRef.slice(0, 500);
    if (metrics.costAmount !== undefined) {
      metrics.costCurrency = "USD";
      metrics.costKind = "provider_reported";
    }
    if (Object.keys(metrics).length > 0) {
      metrics.usageSource = `${provider}-json`;
      return metrics;
    }
  }
  return null;
}

function numberMetric(object: Record<string, unknown>, source: string, target: string): Partial<AgentUsageMetrics> {
  const value = object[source];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? { [target]: Math.trunc(value) } : {};
}

function stringMetric(object: Record<string, unknown>, key: string): string | null {
  return typeof object[key] === "string" && object[key].length > 0 ? object[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CodexAgentExecutor extends CommandBackedAgentExecutor {
  public readonly provider = "codex" as const;
  public readonly capabilities = ["workspace-write", "stream-json"] as const;

  public commandArguments(): readonly string[] {
    return ["exec", "--sandbox", "workspace-write", "--ephemeral", "--json", "-"];
  }
}

/** Claude Code adapter. It receives the prompt through stdin and never owns GitHub lifecycle actions. */
export class ClaudeCodeAgentExecutor extends CommandBackedAgentExecutor {
  public readonly provider = "claude-code" as const;
  public readonly capabilities = ["workspace-write", "stream-json"] as const;

  public commandArguments(): readonly string[] {
    return ["--print", "--output-format", "json"];
  }
}
