import { mkdir, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { AuditEventRepository, ProjectRecord, ProjectRepository } from "@ade-control-plane/database";

import type { CommandRunner } from "./CommandRunner.js";
import { matchesGithubRemote } from "./ProjectCheckout.js";
import { observeCommand } from "./ExecutionDiagnostics.js";

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
      action: "project.checkout.failed", result: "deferred", metadata: { checkout: readCheckout(input.project) ?? "invalid", reason: provisioningFailureCode(error), host: "github.com",
        action: error instanceof ProjectProvisioningError ? error.safeSummary : "Inspect the worker provisioning diagnostic." },
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
    const remote = await observeCommand(input.commands, { executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment, ...(input.signal ? { signal: input.signal } : {}) });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new ProjectProvisioningError("CHECKOUT_REMOTE_MISMATCH", "The project checkout origin does not match the registered repository.");
  } else {
    const repository = `git@github.com:${input.project.repositoryOwner}/${input.project.repositoryName}.git`;
    const timeout = AbortSignal.timeout(30_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    try {
      const preflight = await observeCommand(input.commands, { executable: "git", args: ["ls-remote", "--exit-code", "--heads", repository, `refs/heads/${baseBranch}`], cwd: input.projectRoot, env: input.gitEnvironment, signal });
      if (preflight.exitCode !== 0) {
        if (preflight.exitCode === 2) throw new ProjectProvisioningError("GIT_BRANCH_NOT_FOUND", "The registered base branch was not found. Check the project base branch in Dashboard.");
        throw gitProvisioningFailure(preflight.stderr, "GIT_PREFLIGHT_FAILED");
      }
    } catch (error) {
      if (timeout.aborted && !input.signal?.aborted) throw new ProjectProvisioningError("GIT_NETWORK_FAILED", "GitHub Git preflight timed out. Check worker network connectivity.");
      throw error;
    }
    const clone = await observeCommand(input.commands, { executable: "git", args: ["clone", "--branch", baseBranch, "--single-branch", repository, target], cwd: input.projectRoot, env: input.gitEnvironment, ...(input.signal ? { signal: input.signal } : {}) });
    if (clone.exitCode !== 0) throw gitProvisioningFailure(clone.stderr, "GIT_CLONE_FAILED");
    const remote = await observeCommand(input.commands, { executable: "git", args: ["-C", target, "remote", "get-url", "origin"], cwd: input.projectRoot, env: input.gitEnvironment, ...(input.signal ? { signal: input.signal } : {}) });
    if (remote.exitCode !== 0 || !matchesGithubRemote(remote.stdout, input.project.repositoryOwner, input.project.repositoryName)) throw new ProjectProvisioningError("CHECKOUT_REMOTE_MISMATCH", "The project checkout origin does not match the registered repository.");
  }
  await input.persistence.auditEvents.append({
    occurredAt: input.now().toISOString(), category: "project-onboarding", severity: "info", actorType: "system", actorRef: "v0-worker", projectId: input.project.id,
    action: "project.checkout.ready", result: "observed", metadata: { checkout, baseBranch },
  });
}

export class ProjectProvisioningError extends Error {
  public constructor(
    public readonly code: "CHECKOUT_UNAVAILABLE" | "CHECKOUT_CONFIGURATION_INVALID" | "CHECKOUT_PATH_INVALID" | "CHECKOUT_REMOTE_MISMATCH" | "GIT_CLONE_FAILED" | "CHECKOUT_PROVISION_FAILED" | "GIT_PREFLIGHT_FAILED" | "GIT_BRANCH_NOT_FOUND" | "HOST_KEY_VERIFICATION_FAILED" | "GIT_AUTH_FAILED" | "REPOSITORY_NOT_FOUND" | "REPOSITORY_ACCESS_DENIED" | "GIT_NETWORK_FAILED",
    public readonly safeSummary: string,
  ) {
    super(safeSummary);
    this.name = "ProjectProvisioningError";
  }
}

function gitProvisioningFailure(stderr: string, fallback: "GIT_PREFLIGHT_FAILED" | "GIT_CLONE_FAILED"): ProjectProvisioningError {
  // Match locally, return fixed operator guidance; never copy credentials or
  // arbitrary remote output into summaries/audit metadata.
  if (/host key verification failed|remote host identification has changed|no .* host key is known/i.test(stderr)) return new ProjectProvisioningError("HOST_KEY_VERIFICATION_FAILED", "GitHub SSH host verification failed. Deploy the worker image with the verified GitHub host-key pin; never disable host checking.");
  if (/permission denied \(publickey|authentication failed|could not read username|invalid username or (?:password|token)|bad permissions|unprotected private key/i.test(stderr)) return new ProjectProvisioningError("GIT_AUTH_FAILED", "GitHub Git authentication failed. Check the worker SSH identity, file permissions and repository authorization; the GitHub App API credential is separate.");
  if (/repository not found|repository .* does not exist/i.test(stderr)) return new ProjectProvisioningError("REPOSITORY_NOT_FOUND", "GitHub reports the repository missing or hidden from this identity. Check the registered repository and its SSH access rights.");
  if (/access denied|permission .* denied|write access .* not granted|requested url returned error: 403/i.test(stderr)) return new ProjectProvisioningError("REPOSITORY_ACCESS_DENIED", "GitHub denied repository access. Grant the worker identity the required repository permissions.");
  if (/could not resolve|name or service not known|temporary failure in name resolution|connection timed out|connection refused|network is unreachable|connection reset|could not connect/i.test(stderr)) return new ProjectProvisioningError("GIT_NETWORK_FAILED", "GitHub Git connectivity failed. Check worker DNS, outbound SSH and network availability.");
  return new ProjectProvisioningError(fallback, fallback === "GIT_PREFLIGHT_FAILED" ? "GitHub Git preflight failed. Inspect the sanitized execution diagnostic." : "The worker could not provision the project checkout. Inspect the sanitized execution diagnostic.");
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
