import type { CommandOutput, CommandResult, CommandRunner } from "./v0/CommandRunner.js";

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
  execute(request: AgentExecutionRequest): Promise<CommandResult>;
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

  public execute(request: AgentExecutionRequest): Promise<CommandResult> {
    return this.options.commands.run({
      executable: this.options.executable,
      args: this.commandArguments(),
      cwd: request.cwd,
      stdin: request.prompt,
      env: this.options.environment,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.onOutput ? { onOutput: request.onOutput } : {}),
    });
  }
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
