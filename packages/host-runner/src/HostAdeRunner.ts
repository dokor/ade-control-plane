import { spawn, type ChildProcess } from "node:child_process";

import {
  AdeClientError,
  LocalProcessAdeClient,
  type AdeProcessExecution,
  type AdeProcessExecutor,
  type AdeProjectRef,
} from "@ade-control-plane/ade-client";
import type { RunnerExecutor, RunnerRequest } from "@ade-control-plane/runner-protocol";

export interface HostAdeRunnerOptions {
  command: string;
  baseArgs?: readonly string[];
  environment?: Readonly<Record<string, string>>;
}

interface ActiveProcess {
  child: ChildProcess;
  terminate: () => void;
}

/**
 * Translates only the five versioned runner capabilities to the existing ADE
 * adapter. The worker never contributes a command, argument, environment or
 * working directory.
 */
export class HostAdeRunner implements RunnerExecutor {
  private readonly active = new Map<string, ActiveProcess>();

  public constructor(private readonly options: HostAdeRunnerOptions) {}

  public async execute(request: RunnerRequest, workspacePath: string): Promise<{
    status: "succeeded" | "failed" | "unknown";
    result?: unknown;
  }> {
    const input = request.input as Record<string, unknown>;
    const project = this.project(request, input);
    const client = new LocalProcessAdeClient({
      command: this.options.command,
      ...(this.options.baseArgs ? { baseArgs: this.options.baseArgs } : {}),
      timeoutMs: request.limits.timeoutMs,
      ...(request.limits.maxOutputBytes ? { maxOutputBytes: request.limits.maxOutputBytes } : {}),
      executor: new HostAdeProcessExecutor({
        active: this.active,
        ...(this.options.environment ? { environment: this.options.environment } : {}),
        executionId: request.executionId,
        workspacePath,
      }),
    });

    try {
      let result: unknown;
      switch (request.capability) {
        case "ade.status": result = await client.getStatus(project); break;
        case "ade.runnable-work": result = await client.getRunnableWork(project); break;
        case "ade.advance": result = await client.advance(project, {
          controlPlaneExecutionId: request.executionId,
          ...(typeof input.workRef === "string" ? { workRef: input.workRef } : {}),
        }); break;
        case "ade.apply-decision": result = await client.applyHumanDecision(project, {
          actorRef: input.actorRef as string,
          decisionRef: input.decisionRef as string,
          option: input.option as string,
        }); break;
        case "execution.reconcile": result = await client.reconcileExecution(
          project,
          request.executionId,
          typeof input.adeExecutionRef === "string" ? input.adeExecutionRef : undefined,
        ); break;
      }
      return { status: "succeeded", result: redactResult(result) };
    } catch (error) {
      if (error instanceof AdeClientError && error.retryClassification === "reconcile-first") throw error;
      return {
        status: "failed",
        result: { code: error instanceof AdeClientError ? error.code : "ADE_RUNNER_FAILED" },
      };
    }
  }

  /** Only runner-owned execution IDs can target a runner-owned process group. */
  public cancel(executionId: string): boolean {
    const active = this.active.get(executionId);
    if (!active) return false;
    active.terminate();
    return true;
  }

  public cancelAll(): void {
    for (const executionId of [...this.active.keys()]) this.cancel(executionId);
  }

  private project(request: RunnerRequest, input: Record<string, unknown>): AdeProjectRef {
    return {
      projectId: request.projectId,
      projectRef: input.projectRef as string,
      // Repository identity belongs to the control-plane registry. ADE's local
      // process contract only needs the locally allow-listed project reference.
      repository: "runner-local",
    };
  }
}

interface HostAdeProcessExecutorOptions {
  active: Map<string, ActiveProcess>;
  environment?: Readonly<Record<string, string>>;
  executionId: string;
  workspacePath: string;
}

class HostAdeProcessExecutor implements AdeProcessExecutor {
  public constructor(private readonly options: HostAdeProcessExecutorOptions) {}

  public execute(
    command: string,
    args: readonly string[],
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<AdeProcessExecution> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.options.workspacePath,
        detached: process.platform !== "win32",
        env: this.safeEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const terminate = (): void => terminateProcessGroup(child);
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.options.active.get(this.options.executionId)?.child === child) {
          this.options.active.delete(this.options.executionId);
        }
        callback();
      };
      this.options.active.set(this.options.executionId, { child, terminate });
      timer = setTimeout(() => {
        terminate();
        finish(() => reject(new AdeClientError("ADE_PROCESS_TIMEOUT", "reconcile-first", "ADE process timed out.")));
      }, timeoutMs);
      child.once("error", () => finish(() => reject(new AdeClientError("ADE_PROCESS_SPAWN_FAILED", "safe", "ADE process could not be started."))));
      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxOutputBytes) {
          terminate();
          finish(() => reject(new AdeClientError("ADE_PROCESS_OUTPUT_LIMIT", "safe", "ADE process exceeded the output limit.")));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        // Stderr is deliberately not returned or persisted here. Count it so a
        // noisy child cannot create an unbounded in-memory stream.
        stderrBytes = Math.min(maxOutputBytes + 1, stderrBytes + chunk.length);
        if (stderrBytes > maxOutputBytes) terminate();
      });
      child.once("close", (code) => finish(() => resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
      })));
    });
  }

  private safeEnvironment(): NodeJS.ProcessEnv {
    const safe: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "XDG_CONFIG_HOME"]) {
      const value = process.env[name];
      if (value) safe[name] = value;
    }
    return { ...safe, ...this.options.environment };
  }
}

function terminateProcessGroup(child: ChildProcess): void {
  if (child.pid && process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); return; } catch { /* fall through */ }
  }
  child.kill("SIGTERM");
}

function redactResult(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactResult);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactResult(item)]));
  }
  return value;
}

function redact(value: string): string {
  return value
    .replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{12,}/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}
