import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { hostname } from "node:os";
import type { ProjectRecord } from "@ade-control-plane/database";
import type { CommandRunner } from "./CommandRunner.js";
import type { V0ProjectCheckout } from "./ProjectCheckout.js";
import { ProjectProvisioningError } from "./ProjectProvisioner.js";

export interface WorkspaceOwner { projectId: string; executionId: string; kind: "task" | "github" }
export interface ExecutionWorkspace extends V0ProjectCheckout { release(): Promise<void> }

/** Independent clones: no shared index, branch refs, hooks or mutable working tree. */
export class ExecutionWorkspaces {
  private readonly active = new Map<string, ProjectRecord>();
  constructor(private readonly options: { projectRoot: string; commands: CommandRunner; environment: Readonly<Record<string, string>> }) {}

  resolveProject(cwd: string): ProjectRecord | undefined { return this.active.get(cwd); }

  private async root(): Promise<string> {
    const parent = await realpath(this.options.projectRoot);
    const root = join(parent, ".ade-executions");
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error("Execution workspace root is not a direct directory.");
    return root;
  }

  async prepare(project: ProjectRecord, executionId: string, kind: WorkspaceOwner["kind"], signal?: AbortSignal): Promise<ExecutionWorkspace> {
    signal?.throwIfAborted();
    const config = project.configuration.v0 as { baseBranch?: unknown } | undefined;
    const baseBranch = config?.baseBranch ?? "main";
    if (typeof baseBranch !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(baseBranch)) throw new Error("Invalid workspace base branch.");
    const root = await this.root();
    const directory = await mkdtemp(join(root, "execution-"));
    const checkout = join(directory, "checkout");
    const owner = { version: 1, directory: basename(directory), projectId: project.id, executionId, kind, host: hostname(), pid: process.pid };
    const manifest = JSON.stringify(owner);
    await writeFile(join(directory, "owner.json"), manifest, { flag: "wx", mode: 0o600 });
    const release = async () => {
      await this.remove(root, directory, manifest);
      this.active.delete(checkout);
    };
    try {
      const clone = await this.options.commands.run({ executable: "git", args: ["clone", "--no-checkout", "--single-branch", "--branch", baseBranch,
        `https://github.com/${project.repositoryOwner}/${project.repositoryName}.git`, checkout], cwd: root, env: this.options.environment, ...(signal ? { signal } : {}) });
      if (clone.exitCode !== 0) throw new ProjectProvisioningError("GIT_CLONE_FAILED", "Isolated execution clone failed.");
      if ((await lstat(checkout)).isSymbolicLink() || await realpath(checkout) !== checkout) throw new Error("Invalid isolated checkout.");
      this.active.set(checkout, project);
      // Materialize the no-checkout HTTPS clone BEFORE the executor's dirty guard.
      const baseline = await this.options.commands.run({ executable: "git", args: ["-c", "core.hooksPath=/dev/null", "switch", "--detach", `origin/${baseBranch}`],
        cwd: checkout, env: this.options.environment, ...(signal ? { signal } : {}) });
      if (baseline.exitCode !== 0) throw new Error("Isolated execution baseline could not be prepared.");
      return { root: checkout, baseBranch, release };
    } catch (error) {
      await release().catch(() => undefined);
      throw error;
    }
  }

  /** Only durable terminal owners may be reclaimed; unknown/running owners remain untouched. */
  async reclaimAbandoned(isTerminal: (owner: WorkspaceOwner) => Promise<boolean>): Promise<void> {
    const root = await this.root();
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^execution-[A-Za-z0-9]+$/.test(entry.name)) continue;
      const directory = join(root, entry.name);
      if (this.active.has(join(directory, "checkout"))) continue;
      try {
        const metadata = join(directory, "owner.json");
        const stat = await lstat(metadata);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) continue;
        const manifest = await readFile(metadata, "utf8");
        const owner = JSON.parse(manifest);
        if (owner.version !== 1 || owner.directory !== entry.name || typeof owner.projectId !== "string" || typeof owner.executionId !== "string"
          || !["task", "github"].includes(owner.kind)) continue;
        // Do not trust a terminal DB row alone while its worker is still alive.
        if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue;
        try { process.kill(owner.pid, 0); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue; }
        if (await isTerminal(owner)) await this.remove(root, directory, manifest);
      } catch { /* Fail closed: retain unrecognized or inaccessible workspaces. */ }
    }
  }

  private async remove(root: string, directory: string, manifest: string): Promise<void> {
    if (await this.root() !== root || (await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory
      || await readFile(join(directory, "owner.json"), "utf8") !== manifest) throw new Error("Workspace ownership changed; cleanup refused.");
    // The exact generated child was validated above, never a registered checkout.
    await rm(directory, { recursive: true, force: false });
  }
}
