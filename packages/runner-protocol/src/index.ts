import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const RUNNER_PROTOCOL_VERSION = "1" as const;
export type RunnerCapability = "ade.status" | "ade.runnable-work" | "ade.advance" | "ade.apply-decision" | "execution.reconcile";
export type Retryability = "never" | "safe" | "reconcile-first";

export interface RunnerRequest {
  protocolVersion: typeof RUNNER_PROTOCOL_VERSION;
  requestId: string;
  executionId: string;
  projectId: string;
  capability: RunnerCapability;
  workspaceRef: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  lease: { leaseId: string; leaseKey: string };
  limits: { timeoutMs: number; maxOutputBytes?: number };
  input: unknown;
}

export interface RunnerResponse {
  protocolVersion: typeof RUNNER_PROTOCOL_VERSION;
  requestId: string;
  executionId: string;
  runnerId: string;
  status: "accepted" | "running" | "succeeded" | "failed" | "unknown" | "rejected";
  result?: unknown;
  error?: { code: string; message: string; retryability: Retryability };
}

export interface RunnerProjectPolicy {
  root: string;
  capabilities: readonly RunnerCapability[];
}

export interface RunnerExecutor {
  execute(request: RunnerRequest, workspacePath: string): Promise<{
    status: Extract<RunnerResponse["status"], "accepted" | "running" | "succeeded" | "failed" | "unknown">;
    result?: unknown;
  }>;
}

export interface SecureRunnerOptions {
  runnerId: string;
  sharedSecret: string;
  projects: Readonly<Record<string, RunnerProjectPolicy>>;
  executor: RunnerExecutor;
  now?: () => Date;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
}

/** A deny-by-default runner boundary. It never accepts a shell command. */
export class SecureRunner {
  private readonly consumed = new Map<string, number>();
  private readonly now: () => Date;
  private readonly maxTimeoutMs: number;
  private readonly maxOutputBytes: number;

  public constructor(private readonly options: SecureRunnerOptions) {
    this.now = options.now ?? (() => new Date());
    this.maxTimeoutMs = options.maxTimeoutMs ?? 60_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  }

  public async handle(rawRequest: unknown, signature: string | undefined): Promise<RunnerResponse> {
    const requestId = isObject(rawRequest) && typeof rawRequest.requestId === "string" ? rawRequest.requestId : "invalid";
    const executionId = isObject(rawRequest) && typeof rawRequest.executionId === "string" ? rawRequest.executionId : "invalid";
    const reject = (code: string, message: string, retryability: Retryability = "never"): RunnerResponse => ({
      protocolVersion: RUNNER_PROTOCOL_VERSION, requestId, executionId, runnerId: this.options.runnerId,
      status: "rejected", error: { code, message, retryability },
    });

    const parsed = parseRequest(rawRequest);
    if (!parsed.ok) return reject(parsed.code, parsed.message);
    const request = parsed.value;
    if (!verifyRequestSignature(request, this.options.sharedSecret, signature)) return reject("AUTHENTICATION_FAILED", "Runner request authentication failed.");
    const now = this.now().getTime();
    this.pruneConsumed(now);
    if (Date.parse(request.expiresAt) <= now || Date.parse(request.issuedAt) > now) return reject("REQUEST_EXPIRED", "Runner request is expired.", "safe");
    if (this.consumed.has(request.requestId) || this.consumed.has(request.nonce)) return reject("REQUEST_REPLAYED", "Runner request was already consumed.");
    if (request.limits.timeoutMs > this.maxTimeoutMs || (request.limits.maxOutputBytes ?? 0) > this.maxOutputBytes) return reject("LIMIT_EXCEEDED", "Runner request exceeds configured limits.");
    const project = this.options.projects[request.projectId];
    if (!project) return reject("PROJECT_NOT_ALLOWED", "Project is not allowed on this runner.");
    if (!project.capabilities.includes(request.capability)) return reject("CAPABILITY_NOT_ALLOWED", "Capability is not allowed for this project.");
    if (!validCapabilityInput(request.capability, request.input, request.executionId)) return reject("INPUT_INVALID", "Runner capability input is invalid.");
    let workspacePath: string;
    try { workspacePath = await resolveWorkspace(project.root, request.workspaceRef); }
    catch { return reject("WORKSPACE_CONTAINMENT_FAILED", "Workspace reference is outside the configured project root."); }
    this.consumed.set(request.requestId, Date.parse(request.expiresAt));
    this.consumed.set(request.nonce, Date.parse(request.expiresAt));
    try {
      const result = await this.options.executor.execute(request, workspacePath);
      return { protocolVersion: RUNNER_PROTOCOL_VERSION, requestId: request.requestId, executionId: request.executionId, runnerId: this.options.runnerId, status: result.status, ...(result.result === undefined ? {} : { result: result.result }) };
    } catch {
      return { protocolVersion: RUNNER_PROTOCOL_VERSION, requestId: request.requestId, executionId: request.executionId, runnerId: this.options.runnerId, status: "unknown", error: { code: "EXECUTION_STATE_UNKNOWN", message: "Runner execution completion is unknown.", retryability: "reconcile-first" } };
    }
  }

  private pruneConsumed(now: number): void { for (const [key, expiresAt] of this.consumed) if (expiresAt <= now) this.consumed.delete(key); }
}

export function signRunnerRequest(request: RunnerRequest, sharedSecret: string): string {
  return createHmac("sha256", sharedSecret).update(canonicalize(request)).digest("hex");
}

export function verifyRequestSignature(request: RunnerRequest, sharedSecret: string, signature: string | undefined): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signRunnerRequest(request, sharedSecret), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function resolveWorkspace(root: string, workspaceRef: string): Promise<string> {
  if (!workspaceRef || isAbsolute(workspaceRef)) throw new Error("absolute workspace reference");
  const canonicalRoot = await realpath(root);
  const candidate = await realpath(resolve(canonicalRoot, workspaceRef));
  const pathRelative = relative(canonicalRoot, candidate);
  if (pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative))) return candidate;
  throw new Error("workspace escapes root");
}

export function createUnixRunnerServer(socketPath: string, runner: SecureRunner) {
  return createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/requests") { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) { if (chunks.reduce((size, value) => size + value.length, 0) > 128 * 1024) { res.writeHead(413).end(); return; } chunks.push(Buffer.from(chunk)); }
    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { payload = {}; }
    const response = await runner.handle(payload, readHeader(req.headers["x-runner-signature"]));
    res.writeHead(response.status === "rejected" ? 403 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  }).listen(socketPath);
}

export function sendUnixRunnerRequest(socketPath: string, request: RunnerRequest, sharedSecret: string): Promise<RunnerResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const body = JSON.stringify(request);
    const client = httpRequest({ socketPath, path: "/v1/requests", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-runner-signature": signRunnerRequest(request, sharedSecret) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => { try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")) as RunnerResponse); } catch { rejectPromise(new Error("Runner returned invalid JSON.")); } });
    });
    client.once("error", rejectPromise); client.end(body);
  });
}

function parseRequest(value: unknown): { ok: true; value: RunnerRequest } | { ok: false; code: string; message: string } {
  if (!isObject(value)) return { ok: false, code: "REQUEST_INVALID", message: "Runner request must be an object." };
  const allowed = new Set(["protocolVersion", "requestId", "executionId", "projectId", "capability", "workspaceRef", "issuedAt", "expiresAt", "nonce", "lease", "limits", "input"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return { ok: false, code: "REQUEST_INVALID", message: "Runner request has unknown fields." };
  const strings = ["requestId", "executionId", "projectId", "capability", "workspaceRef", "issuedAt", "expiresAt", "nonce"] as const;
  if (value.protocolVersion !== RUNNER_PROTOCOL_VERSION || strings.some((key) => typeof value[key] !== "string" || value[key] === "")) return { ok: false, code: "REQUEST_INVALID", message: "Runner request is structurally invalid." };
  const lease = value.lease;
  const limits = value.limits;
  if (!isObject(lease) || typeof lease.leaseId !== "string" || typeof lease.leaseKey !== "string" || !isObject(limits)) return { ok: false, code: "REQUEST_INVALID", message: "Runner request lease or limits are invalid." };
  const timeoutMs = limits.timeoutMs;
  const maxOutputBytes = limits.maxOutputBytes;
  if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || (maxOutputBytes !== undefined && (typeof maxOutputBytes !== "number" || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0))) return { ok: false, code: "REQUEST_INVALID", message: "Runner request lease or limits are invalid." };
  const issuedAt = value.issuedAt;
  const expiresAt = value.expiresAt;
  const capability = value.capability;
  if (typeof capability !== "string" || !isCapability(capability) || typeof issuedAt !== "string" || typeof expiresAt !== "string" || Number.isNaN(Date.parse(issuedAt)) || Number.isNaN(Date.parse(expiresAt))) return { ok: false, code: "REQUEST_INVALID", message: "Runner request capability or timestamps are invalid." };
  return { ok: true, value: value as unknown as RunnerRequest };
}

function validCapabilityInput(capability: RunnerCapability, input: unknown, executionId: string): boolean {
  if (!isObject(input)) return false;
  const projectRef = typeof input.projectRef === "string" && input.projectRef !== "";
  if (capability === "ade.status" || capability === "ade.runnable-work") return projectRef && exactKeys(input, ["projectRef"]);
  if (capability === "ade.advance") return projectRef && input.controlPlaneExecutionId === executionId && (input.workRef === undefined || typeof input.workRef === "string") && exactKeys(input, ["projectRef", "controlPlaneExecutionId", "workRef"]);
  if (capability === "ade.apply-decision") return projectRef && typeof input.decisionRef === "string" && typeof input.option === "string" && typeof input.actorRef === "string" && exactKeys(input, ["projectRef", "decisionRef", "option", "actorRef"]);
  return input.controlPlaneExecutionId === executionId && (input.adeExecutionRef === undefined || typeof input.adeExecutionRef === "string") && exactKeys(input, ["controlPlaneExecutionId", "adeExecutionRef"]);
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCapability(value: string): value is RunnerCapability { return ["ade.status", "ade.runnable-work", "ade.advance", "ade.apply-decision", "execution.reconcile"].includes(value); }
function exactKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(input).every((key) => allowed.includes(key)); }
function readHeader(value: string | string[] | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
