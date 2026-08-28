import { randomBytes, randomUUID } from "node:crypto";

import {
  parseAdeAdvanceResult,
  parseAdeExecutionReconciliation,
  parseAdeRunnableWork,
  type AdeAdvanceResult,
  type AdeProjectRef,
  type AdeRunnableWork,
} from "@ade-control-plane/ade-client";
import {
  RUNNER_PROTOCOL_VERSION,
  sendUnixRunnerRequest,
  type RunnerCapability,
  type RunnerRequest,
  type RunnerResponse,
} from "@ade-control-plane/runner-protocol";

import type { RunnerControlPlaneClient } from "./index.js";

export interface UnixRunnerProjectBinding {
  workspaceRef: string;
  leaseId: string;
  leaseKey: string;
}

export interface UnixRunnerControlPlaneClientOptions {
  socketPath: string;
  sharedSecret: string;
  projects: Readonly<Record<string, UnixRunnerProjectBinding>>;
  requestTtlMs?: number;
  send?: (socketPath: string, request: RunnerRequest, sharedSecret: string, timeoutMs: number) => Promise<RunnerResponse>;
}

/** Worker-side typed UDS client. It never exposes a command or a path argument. */
export class UnixRunnerControlPlaneClient implements RunnerControlPlaneClient {
  private readonly requestTtlMs: number;
  private readonly send: NonNullable<UnixRunnerControlPlaneClientOptions["send"]>;

  public constructor(private readonly options: UnixRunnerControlPlaneClientOptions) {
    this.requestTtlMs = options.requestTtlMs ?? 30_000;
    this.send = options.send ?? sendUnixRunnerRequest;
    if (!Number.isSafeInteger(this.requestTtlMs) || this.requestTtlMs <= 0) throw new Error("Runner request TTL must be positive.");
  }

  public async getRunnableWork(project: AdeProjectRef): Promise<AdeRunnableWork | null> {
    return parseAdeRunnableWork((await this.request(project, "ade.runnable-work", this.readExecutionId(), {
      projectRef: project.projectRef,
    })).result);
  }

  public async advance(project: AdeProjectRef, request: { controlPlaneExecutionId: string; workRef: string }): Promise<AdeAdvanceResult> {
    const response = await this.request(project, "ade.advance", request.controlPlaneExecutionId, {
      projectRef: project.projectRef,
      controlPlaneExecutionId: request.controlPlaneExecutionId,
      workRef: request.workRef,
    });
    return parseAdeAdvanceResult(response.result);
  }

  public async reconcile(project: AdeProjectRef, executionId: string, adeExecutionRef?: string): Promise<{
    state: "succeeded" | "failed" | "cancelled" | "unknown" | "running" | "not-found";
    summary?: string;
  }> {
    const response = await this.request(project, "execution.reconcile", executionId, {
      controlPlaneExecutionId: executionId,
      ...(adeExecutionRef ? { adeExecutionRef } : {}),
    });
    const result = parseAdeExecutionReconciliation(response.result);
    return { state: result.state, ...(result.summary ? { summary: result.summary } : {}) };
  }

  private async request(
    project: AdeProjectRef,
    capability: RunnerCapability,
    executionId: string,
    input: unknown,
  ): Promise<RunnerResponse> {
    const binding = this.options.projects[project.projectId];
    if (!binding) throw new Error("Runner project binding is not configured.");
    const issuedAt = new Date();
    const timeoutMs = 10_000;
    const response = await this.send(this.options.socketPath, {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: randomUUID(),
      executionId,
      projectId: project.projectId,
      capability,
      workspaceRef: binding.workspaceRef,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + this.requestTtlMs).toISOString(),
      nonce: randomBytes(24).toString("base64url"),
      lease: { leaseId: binding.leaseId, leaseKey: binding.leaseKey },
      limits: { timeoutMs, maxOutputBytes: 64 * 1024 },
      input,
    }, this.options.sharedSecret, timeoutMs + 1_000);
    if (response.status === "succeeded") return response;
    // Do not copy runner/process error text into logs. Unknown is deliberately
    // surfaced as an exception so the durable coordinator reconciles first.
    throw new Error(response.status === "unknown" ? "Runner outcome is unknown; reconciliation is required." : "Runner rejected or failed the typed request.");
  }

  private readExecutionId(): string {
    return `read:${randomUUID()}`;
  }
}
