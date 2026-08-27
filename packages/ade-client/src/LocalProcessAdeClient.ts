import { spawn } from "node:child_process";

import type {
  AdeAdvanceRequest,
  AdeAdvanceResult,
  AdeCapabilities,
  AdeClient,
  AdeExecutionReconciliation,
  AdeHumanDecision,
  AdeHumanDecisionResult,
  AdeOperation,
  AdeProjectRef,
  AdeProjectStatus,
  AdeRunnableWork,
} from "./domain.js";
import { AdeClientError, retryClassificationFor } from "./errors.js";
import {
  parseAdeAdvanceResult,
  parseAdeCapabilities,
  parseAdeExecutionReconciliation,
  parseAdeHumanDecisionResult,
  parseAdeProjectStatus,
  parseAdeRunnableWork,
  parseEnvelope,
} from "./validation.js";

export interface AdeProcessExecution {
  exitCode: number;
  stdout: string;
}

/** The host runner can supply its own executor without changing ADE domain calls. */
export interface AdeProcessExecutor {
  execute(command: string, args: readonly string[], timeoutMs: number, maxOutputBytes: number): Promise<AdeProcessExecution>;
}

export interface LocalProcessAdeClientOptions {
  command: string;
  baseArgs?: readonly string[];
  executor?: AdeProcessExecutor;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export class LocalProcessAdeClient implements AdeClient {
  private readonly baseArgs: readonly string[];
  private readonly executor: AdeProcessExecutor;
  private readonly maxOutputBytes: number;
  private readonly timeoutMs: number;

  public constructor(private readonly options: LocalProcessAdeClientOptions) {
    this.baseArgs = options.baseArgs ?? [];
    this.executor = options.executor ?? new NodeAdeProcessExecutor();
    this.maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) {
      throw new Error("maxOutputBytes must be a positive integer.");
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive integer.");
    }
  }

  public async getCapabilities(project: AdeProjectRef): Promise<AdeCapabilities> {
    return this.invoke("capabilities", project, undefined, parseAdeCapabilities);
  }

  public async getStatus(project: AdeProjectRef): Promise<AdeProjectStatus> {
    return this.invoke("status", project, undefined, parseAdeProjectStatus);
  }

  public async getRunnableWork(project: AdeProjectRef): Promise<AdeRunnableWork | null> {
    return this.invoke("runnable-work", project, undefined, parseAdeRunnableWork);
  }

  public async advance(project: AdeProjectRef, request: AdeAdvanceRequest): Promise<AdeAdvanceResult> {
    return this.invoke("advance", project, request, parseAdeAdvanceResult);
  }

  public async applyHumanDecision(project: AdeProjectRef, decision: AdeHumanDecision): Promise<AdeHumanDecisionResult> {
    return this.invoke("apply-decision", project, decision, parseAdeHumanDecisionResult);
  }

  public async reconcileExecution(
    project: AdeProjectRef,
    controlPlaneExecutionId: string,
    adeExecutionRef?: string,
  ): Promise<AdeExecutionReconciliation> {
    return this.invoke(
      "reconcile",
      project,
      { controlPlaneExecutionId, ...(adeExecutionRef ? { adeExecutionRef } : {}) },
      parseAdeExecutionReconciliation,
    );
  }

  private async invoke<T>(
    operation: AdeOperation,
    project: AdeProjectRef,
    input: unknown,
    parser: (value: unknown) => T,
  ): Promise<T> {
    const args = [
      ...this.baseArgs,
      "control-plane",
      operation,
      "--project",
      project.projectRef,
      "--json",
      ...(input === undefined ? [] : ["--input-json", JSON.stringify(input)]),
    ];

    let response: AdeProcessExecution;
    try {
      response = await this.executor.execute(
        this.options.command,
        args,
        this.timeoutMs,
        this.maxOutputBytes,
      );
    } catch (error) {
      if (error instanceof AdeClientError) throw this.classifyOperationError(error, operation);
      throw new AdeClientError(
        "ADE_PROCESS_SPAWN_FAILED",
        retryClassificationFor(operation),
        `ADE ${operation} transport could not be started.`,
      );
    }

    if (response.exitCode !== 0) {
      throw new AdeClientError(
        "ADE_PROCESS_EXITED",
        retryClassificationFor(operation),
        `ADE ${operation} exited unsuccessfully.`,
      );
    }

    if (Buffer.byteLength(response.stdout, "utf8") > this.maxOutputBytes) {
      throw this.classifyOperationError(
        new AdeClientError("ADE_PROCESS_OUTPUT_LIMIT", "safe", "ADE process exceeded the output limit."),
        operation,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.stdout);
    } catch {
      throw this.classifyOperationError(
        new AdeClientError(
          "ADE_OUTPUT_INVALID",
          "safe",
          `ADE ${operation} returned invalid JSON.`,
        ),
        operation,
      );
    }

    try {
      return parser(parseEnvelope(parsed, operation));
    } catch (error) {
      if (error instanceof AdeClientError) throw this.classifyOperationError(error, operation);
      throw error;
    }
  }

  private classifyOperationError(error: AdeClientError, operation: AdeOperation): AdeClientError {
    if (error.code === "ADE_PROTOCOL_UNSUPPORTED" || error.code === "ADE_PROCESS_SPAWN_FAILED") {
      return error;
    }
    return new AdeClientError(
      error.code,
      retryClassificationFor(operation),
      error.message,
      error.adeExecutionRef,
    );
  }
}

export class NodeAdeProcessExecutor implements AdeProcessExecutor {
  public execute(
    command: string,
    args: readonly string[],
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<AdeProcessExecution> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;

      let timer: NodeJS.Timeout | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback();
      };
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => reject(new AdeClientError("ADE_PROCESS_TIMEOUT", "reconcile-first", "ADE process timed out.")));
      }, timeoutMs);

      child.once("error", () => {
        finish(() => reject(new AdeClientError("ADE_PROCESS_SPAWN_FAILED", "safe", "ADE process could not be started.")));
      });
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          child.kill("SIGTERM");
          finish(() => reject(new AdeClientError("ADE_PROCESS_OUTPUT_LIMIT", "safe", "ADE process exceeded the output limit.")));
          return;
        }
        chunks.push(chunk);
      });
      child.once("close", (code) => {
        finish(() => resolve({ exitCode: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") }));
      });
    });
  }
}
