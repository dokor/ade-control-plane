import { lstat, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { ProjectRecord, ProjectRepository } from "@ade-control-plane/database";

import type { CommandRunner } from "./CommandRunner.js";
import { matchesGithubRemote } from "./ProjectCheckout.js";

/** Removes only a registered checkout contained by the worker-owned root. */
export class ProjectDeletionProcessor {
  public constructor(private readonly options: {
    persistence: { projects: Pick<ProjectRepository, "getById" | "listDeletionRequests" | "delete"> };
    commands: Pick<CommandRunner, "run">;
    projectRoot: string;
    gitEnvironment: Readonly<Record<string, string>>;
  }) {}

  public async processPending(): Promise<boolean> {
    const request = (await this.options.persistence.projects.listDeletionRequests())[0];
    if (!request) return false;
    const project = await this.options.persistence.projects.getById(request.projectId);
    if (!project) return false;
    await this.removeCheckout(project);
    await this.options.persistence.projects.delete(project.id);
    return true;
  }

  private async removeCheckout(project: ProjectRecord): Promise<void> {
    const checkout = readCheckout(project);
    if (!checkout) throw new Error("Project deletion refused: checkout configuration is invalid.");
    const root = await realpath(this.options.projectRoot);
    const target = resolve(root, checkout);
    assertContained(root, target);
    const entry = await lstat(target).catch(() => null);
    if (!entry) return;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("Project deletion refused: managed checkout is not a directory.");
    }
    const remote = await this.options.commands.run({ executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: root, env: this.options.gitEnvironment });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, project.repositoryOwner, project.repositoryName)) {
      throw new Error("Project deletion refused: checkout remote does not match the registered repository.");
    }
    const worktrees = await this.options.commands.run({ executable: "git", args: ["-C", target, "worktree", "list", "--porcelain"], cwd: root, env: this.options.gitEnvironment });
    if (worktrees.exitCode !== 0) throw new Error("Project deletion refused: worktrees could not be inspected.");
    for (const worktree of worktreePaths(worktrees.stdout)) {
      const worktreeRoot = isAbsolute(worktree) ? resolve(worktree) : resolve(root, worktree);
      if (worktreeRoot === target) continue;
      assertContained(root, worktreeRoot);
      const removal = await this.options.commands.run({ executable: "git", args: ["-C", target, "worktree", "remove", "--force", worktreeRoot], cwd: root, env: this.options.gitEnvironment });
      if (removal.exitCode !== 0) throw new Error("Project deletion refused: a managed worktree could not be removed.");
    }
    await rm(target, { recursive: true, force: true, maxRetries: 2 });
  }
}

function readCheckout(project: ProjectRecord): string | null {
  const v0 = project.configuration.v0;
  if (!v0 || typeof v0 !== "object" || Array.isArray(v0)) return null;
  const checkout = (v0 as Record<string, unknown>).checkout;
  return typeof checkout === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(checkout) && !checkout.includes("..") && !isAbsolute(checkout) ? checkout : null;
}

function assertContained(root: string, target: string): void {
  const path = relative(root, target);
  if (!path || path.startsWith("..") || isAbsolute(path)) throw new Error("Project deletion refused: checkout escapes the managed root.");
}

function worktreePaths(output: string): readonly string[] {
  return output.split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter(Boolean);
}
