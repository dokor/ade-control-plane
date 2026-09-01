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
    await provisionProject({ ...input, root, project, now }).catch(async () => {
      await input.persistence.auditEvents.append({
        occurredAt: now().toISOString(), category: "project-onboarding", severity: "warning", actorType: "system", actorRef: "v0-worker", projectId: project.id,
        action: "project.checkout.failed", result: "deferred", metadata: { checkout: readCheckout(project) ?? "invalid" },
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
  if (!checkout || !baseBranch) throw new Error("Project checkout configuration is invalid.");
  const target = resolve(input.root, checkout);
  const containment = relative(input.root, target);
  if (isAbsolute(containment) || containment.startsWith("..") || containment === "") throw new Error("Project checkout escapes the configured root.");
  await mkdir(dirname(target), { recursive: true });
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    if (!existing.isDirectory()) throw new Error("Project checkout path is not a directory.");
    const remote = await input.commands.run({ executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new Error("Existing project checkout remote does not match the registered repository.");
  } else {
    const clone = await input.commands.run({ executable: "git", args: ["clone", "--branch", baseBranch, "--single-branch", `git@github.com:${input.project.repositoryOwner}/${input.project.repositoryName}.git`, target], cwd: input.projectRoot, env: input.gitEnvironment });
    if (clone.exitCode !== 0) throw new Error("Git clone failed.");
    const remote = await input.commands.run({ executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new Error("Cloned project remote does not match the registered repository.");
  }
  await input.persistence.auditEvents.append({
    occurredAt: input.now().toISOString(), category: "project-onboarding", severity: "info", actorType: "system", actorRef: "v0-worker", projectId: input.project.id,
    action: "project.checkout.ready", result: "observed", metadata: { checkout, baseBranch },
  });
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
