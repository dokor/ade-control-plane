import { mkdir, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { AuditEventRepository, ProjectRecord, ProjectRepository } from "@ade-control-plane/database";

import type { CommandRunner } from "./CommandRunner.js";
import { matchesGithubRemote } from "./ProjectCheckout.js";

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

export async function provisionRegisteredProjects(input: {
  persistence: { projects: Pick<ProjectRepository, "list">; auditEvents: Pick<AuditEventRepository, "append"> };
  commands: Pick<CommandRunner, "run">;
  projectRoot: string;
  gitEnvironment: Readonly<Record<string, string>>;
  now?(): Date;
}): Promise<void> {
  const now = input.now ?? (() => new Date());
  const root = await realpath(input.projectRoot);
  for (const project of await input.persistence.projects.list()) {
    await provisionProject({ ...input, root, project, now }).catch(async (error: unknown) => {
      await input.persistence.auditEvents.append({
        occurredAt: now().toISOString(), category: "project-onboarding", severity: "warning", actorType: "system", actorRef: "v0-worker", projectId: project.id,
        action: "project.checkout.failed", result: "deferred", metadata: { checkout: readCheckout(project) ?? "invalid", reason: provisioningFailureCode(error) },
      }).catch(() => undefined);
    });
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
}): Promise<void> {
  const checkout = readCheckout(input.project);
  const baseBranch = readBaseBranch(input.project);
  if (!checkout || !baseBranch) throw new ProjectProvisioningError("CHECKOUT_CONFIGURATION_INVALID");
  const target = resolve(input.root, checkout);
  const containment = relative(input.root, target);
  if (isAbsolute(containment) || containment.startsWith("..") || containment === "") throw new ProjectProvisioningError("CHECKOUT_CONFIGURATION_INVALID");
  await mkdir(dirname(target), { recursive: true });
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    if (!existing.isDirectory()) throw new ProjectProvisioningError("CHECKOUT_PATH_INVALID");
    const remote = await input.commands.run({ executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new ProjectProvisioningError("CHECKOUT_REMOTE_MISMATCH");
  } else {
    const clone = await input.commands.run({ executable: "git", args: ["clone", "--branch", baseBranch, "--single-branch", `git@github.com:${input.project.repositoryOwner}/${input.project.repositoryName}.git`, target], cwd: input.projectRoot, env: input.gitEnvironment });
    if (clone.exitCode !== 0) throw new ProjectProvisioningError("GIT_CLONE_FAILED");
    const remote = await input.commands.run({ executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new ProjectProvisioningError("CHECKOUT_REMOTE_MISMATCH");
  }
  await input.persistence.auditEvents.append({
    occurredAt: input.now().toISOString(), category: "project-onboarding", severity: "info", actorType: "system", actorRef: "v0-worker", projectId: input.project.id,
    action: "project.checkout.ready", result: "observed", metadata: { checkout, baseBranch },
  });
}

class ProjectProvisioningError extends Error {
  public constructor(public readonly code: string) { super(code); }
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
