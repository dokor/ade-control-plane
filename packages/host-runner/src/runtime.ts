import { lstat, readFile, realpath, unlink } from "node:fs/promises";
import { once } from "node:events";
import { isAbsolute } from "node:path";

import {
  SecureRunner,
  createUnixRunnerServer,
  resolveWorkspace,
  type RunnerCapability,
  type RunnerProjectPolicy,
} from "@ade-control-plane/runner-protocol";

import { HostAdeRunner } from "./HostAdeRunner.js";

export interface HostRunnerRuntimeConfig {
  runnerId: string;
  socketPath: string;
  sharedSecret: string;
  maxOutputBytes: number;
  maxTimeoutMs: number;
  ade: { command: string; baseArgs: readonly string[] };
  projects: Readonly<Record<string, RunnerProjectPolicy & { projectRef: string }>>;
}

export async function loadHostRunnerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HostRunnerRuntimeConfig> {
  const configPath = requiredAbsolute(env.RUNNER_CONFIG_FILE, "RUNNER_CONFIG_FILE");
  const secretPath = requiredAbsolute(env.RUNNER_AUTH_SECRET_FILE, "RUNNER_AUTH_SECRET_FILE");
  const raw = await readFile(configPath, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("RUNNER_CONFIG_FILE must contain JSON."); }
  const config = await parseConfig(parsed);
  const sharedSecret = (await readFile(secretPath, "utf8")).trim();
  if (!sharedSecret) throw new Error("RUNNER_AUTH_SECRET_FILE must contain a secret.");
  return { ...config, sharedSecret };
}

export async function startHostRunner(config: HostRunnerRuntimeConfig) {
  await removeStaleSocket(config.socketPath);
  const executor = new HostAdeRunner({ command: config.ade.command, baseArgs: config.ade.baseArgs });
  const runner = new SecureRunner({
    runnerId: config.runnerId,
    sharedSecret: config.sharedSecret,
    projects: config.projects,
    executor,
    maxTimeoutMs: config.maxTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
  });
  const server = createUnixRunnerServer(config.socketPath, runner);
  await Promise.race([
    once(server, "listening"),
    once(server, "error").then(([error]) => Promise.reject(error)),
  ]);
  return { executor, server };
}

async function parseConfig(value: unknown): Promise<Omit<HostRunnerRuntimeConfig, "sharedSecret">> {
  const record = object(value, "runner configuration");
  exactKeys(record, ["runnerId", "socketPath", "maxOutputBytes", "maxTimeoutMs", "ade", "projects"]);
  const ade = object(record.ade, "runner configuration.ade");
  exactKeys(ade, ["command", "baseArgs"]);
  const projectsRecord = object(record.projects, "runner configuration.projects");
  const projects: Record<string, RunnerProjectPolicy & { projectRef: string }> = {};
  for (const [projectId, rawProject] of Object.entries(projectsRecord)) {
    if (!projectId) throw new Error("Runner project ID must not be empty.");
    const project = object(rawProject, `runner project ${projectId}`);
    exactKeys(project, ["root", "projectRef", "capabilities", "workspaces"]);
    const root = requiredAbsolute(project.root, `runner project ${projectId}.root`);
    const canonicalRoot = await realpath(root);
    const capabilities = capabilityList(project.capabilities, projectId);
    const workspaceValues = object(project.workspaces, `runner project ${projectId}.workspaces`);
    const workspaces: Record<string, string> = {};
    for (const [reference, relativePath] of Object.entries(workspaceValues)) {
      if (!reference || typeof relativePath !== "string" || !relativePath) {
        throw new Error(`Runner project ${projectId} has an invalid workspace mapping.`);
      }
      await resolveWorkspace(canonicalRoot, relativePath);
      workspaces[reference] = relativePath;
    }
    if (!Object.keys(workspaces).length) throw new Error(`Runner project ${projectId} must configure a workspace.`);
    projects[projectId] = {
      root: canonicalRoot,
      projectRef: required(project.projectRef, `runner project ${projectId}.projectRef`),
      capabilities,
      workspaces,
    };
  }
  if (!Object.keys(projects).length) throw new Error("Runner configuration must allow at least one project.");
  return {
    runnerId: required(record.runnerId, "runnerId"),
    socketPath: requiredAbsolute(record.socketPath, "socketPath"),
    maxOutputBytes: positive(record.maxOutputBytes, "maxOutputBytes", 64 * 1024),
    maxTimeoutMs: positive(record.maxTimeoutMs, "maxTimeoutMs", 60_000),
    ade: {
      command: required(ade.command, "runner configuration.ade.command"),
      baseArgs: stringList(ade.baseArgs, "runner configuration.ade.baseArgs"),
    },
    projects,
  };
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    const existing = await lstat(socketPath);
    if (!existing.isSocket()) throw new Error("Runner socket path exists and is not a socket.");
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Runner configuration has unknown fields.");
}
function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be set.`);
  return value.trim();
}
function requiredAbsolute(value: unknown, name: string): string {
  const path = required(value, name);
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path.`);
  return path;
}
function positive(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}
function stringList(value: unknown, name: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name} must be a string array.`);
  return value;
}
function capabilityList(value: unknown, projectId: string): readonly RunnerCapability[] {
  const valid: readonly RunnerCapability[] = ["ade.status", "ade.runnable-work", "ade.advance", "ade.apply-decision", "execution.reconcile"];
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string" || !valid.includes(item as RunnerCapability))) {
    throw new Error(`Runner project ${projectId} has invalid capabilities.`);
  }
  return value as RunnerCapability[];
}
