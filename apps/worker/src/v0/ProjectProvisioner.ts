import { mkdir, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { AuditEventRepository, ProjectRecord, ProjectRepository } from "@ade-control-plane/database";

import type { CommandRunner } from "./CommandRunner.js";
import { matchesGithubRemote } from "./ProjectCheckout.js";

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

type ProjectProvisioningDependencies = {
  persistence: { auditEvents: Pick<AuditEventRepository, "append"> };
  commands: Pick<CommandRunner, "run">;
  projectRoot: string;
  gitEnvironment: Readonly<Record<string, string>>;
  now?(): Date;
  signal?: AbortSignal;
};

/**
 * Ensures one registered project's checkout exists and points at its allow-listed repository.
 *
 * This is intentionally the same path used by the background provisioner so a just-admitted
 * GitHub issue can recover from a worker restart or delayed background provisioning without duplicating
 * checkout policy in the GitHub executor.
 */
export async function provisionProjectCheckout(
  input: ProjectProvisioningDependencies & { project: ProjectRecord },
): Promise<void> {
  const now = input.now ?? (() => new Date());
  try {
    let root: string;
    try {
      root = await realpath(input.projectRoot);
    } catch {
      throw new ProjectProvisioningError("CHECKOUT_UNAVAILABLE", "The worker checkout root is unavailable.");
    }
    await provisionProject({ ...input, root, now });
  } catch (error: unknown) {
    await input.persistence.auditEvents.append({
      occurredAt: now().toISOString(), category: "project-onboarding", severity: "warning", actorType: "system", actorRef: "v0-worker", projectId: input.project.id,
      action: "project.checkout.failed", result: "deferred", metadata: { checkout: readCheckout(input.project) ?? "invalid", reason: provisioningFailureCode(error) },
    }).catch(() => undefined);
    throw error;
  }
}

export async function provisionRegisteredProjects(input: {
  persistence: { projects: Pick<ProjectRepository, "list">; auditEvents: Pick<AuditEventRepository, "append"> };
  commands: Pick<CommandRunner, "run">;
  projectRoot: string;
  gitEnvironment: Readonly<Record<string, string>>;
  now?(): Date;
}): Promise<void> {
  for (const project of await input.persistence.projects.list()) {
    await provisionProjectCheckout({ ...input, project }).catch(() => undefined);
  }
}

async function provisionProject(input: {
  persistence: { auditEvents: Pick<AuditEventRepository, "append"> };
  commands: Pick<CommandRunner, "run">;
  projectRoot: string;
  root: string;
  project: ProjectRecord;
  gitEnvironment: Readonly<Record<string, string>>;
  now: () => Date;
  signal?: AbortSignal;
}): Promise<void> {
  const checkout = readCheckout(input.project);
  const baseBranch = readBaseBranch(input.project);
  if (!checkout || !baseBranch) throw new ProjectProvisioningError("CHECKOUT_CONFIGURATION_INVALID", "The registered project checkout configuration is invalid.");
  const target = resolve(input.root, checkout);
  const containment = relative(input.root, target);
  if (isAbsolute(containment) || containment.startsWith("..") || containment === "") throw new ProjectProvisioningError("CHECKOUT_CONFIGURATION_INVALID", "The registered project checkout path is invalid.");
  await mkdir(dirname(target), { recursive: true });
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    if (!existing.isDirectory()) throw new ProjectProvisioningError("CHECKOUT_PATH_INVALID", "The registered project checkout path is not a directory.");
    const remote = await input.commands.run({ executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment, ...(input.signal ? { signal: input.signal } : {}) });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new ProjectProvisioningError("CHECKOUT_REMOTE_MISMATCH", "The project checkout origin does not match the registered repository.");
  } else {
    const clone = await input.commands.run({ executable: "git", args: ["clone", "--branch", baseBranch, "--single-branch", `git@github.com:${input.project.repositoryOwner}/${input.project.repositoryName}.git`, target], cwd: input.projectRoot, env: input.gitEnvironment, ...(input.signal ? { signal: input.signal } : {}) });
    if (clone.exitCode !== 0) throw new ProjectProvisioningError("GIT_CLONE_FAILED", "The worker could not provision the project checkout.");
    const remote = await input.commands.run({ executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment, ...(input.signal ? { signal: input.signal } : {}) });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new ProjectProvisioningError("CHECKOUT_REMOTE_MISMATCH", "The project checkout origin does not match the registered repository.");
  }
  await input.persistence.auditEvents.append({
    occurredAt: input.now().toISOString(), category: "project-onboarding", severity: "info", actorType: "system", actorRef: "v0-worker", projectId: input.project.id,
    action: "project.checkout.ready", result: "observed", metadata: { checkout, baseBranch },
  });
}

export class ProjectProvisioningError extends Error {
  public constructor(
    public readonly code: "CHECKOUT_UNAVAILABLE" | "CHECKOUT_CONFIGURATION_INVALID" | "CHECKOUT_PATH_INVALID" | "CHECKOUT_REMOTE_MISMATCH" | "GIT_CLONE_FAILED" | "CHECKOUT_PROVISION_FAILED",
    public readonly safeSummary: string,
  ) {
    super(safeSummary);
    this.name = "ProjectProvisioningError";
  }
}

function provisioningFailureCode(error: unknown): string {
  return error instanceof ProjectProvisioningError ? error.code : "CHECKOUT_PROVISION_FAILED";
}

function readCheckout(project: ProjectRecord): string | null {
  const v0 = project.configuration.v0;
  if (!v0 || typeof v0 !== "object" || Array.isArray(v0)) return null;
  const checkout = (v0 as Record<string, unknown>).checkout;
  return typeof checkout === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(checkout) && !checkout.includes("..") ? checkout : null;
}

function readBaseBranch(project: ProjectRecord): string | null {
  const v0 = project.configuration.v0;
  if (!v0 || typeof v0 !== "object" || Array.isArray(v0)) return null;
  const branch = (v0 as Record<string, unknown>).baseBranch ?? "main";
  return typeof branch === "string" && GIT_REF.test(branch) ? branch : null;
}
