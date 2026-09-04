import { realpath } from "node:fs/promises";
import type { ProjectRecord } from "@ade-control-plane/database";
import type { CommandInput, CommandResult, CommandRunner } from "./CommandRunner.js";
import { resolveProjectCheckout, matchesGithubRemote } from "./ProjectCheckout.js";
import { ProjectProvisioningError } from "./ProjectProvisioner.js";

/** Only CP-owned network Git commands receive credentials, never ADE/agent commands. */
export class GithubAppGitRunner implements CommandRunner {
  constructor(private readonly options: {
    commands: CommandRunner;
    projects: { list(): Promise<readonly ProjectRecord[]> };
    projectRoot: string;
    resolveExecutionProject?: (cwd: string) => ProjectRecord | undefined;
    installationId: string;
    tokens: { getRepositoryToken(installationId: string, repository: string): Promise<string> };
  }) {}

  async run(input: CommandInput): Promise<CommandResult> {
    const args = [...input.args];
    let offset = 0;
    while (args[offset] === "-c" || args[offset] === "-C") offset += 2;
    const operation = args[offset];
    if (input.executable !== "git" || !["clone", "ls-remote", "fetch", "push"].includes(operation ?? "")) {
      return this.options.commands.run(input);
    }
    const projects = await this.options.projects.list();
    let project: ProjectRecord | undefined;
    let remoteIndex: number;
    if (operation === "clone" || (operation === "ls-remote" && !args.includes("origin"))) {
      remoteIndex = args.findIndex((arg) => /^(?:https:\/\/github\.com\/|git@github\.com:)/.test(arg));
      project = projects.find((candidate) => matchesGithubRemote(args[remoteIndex] ?? "", candidate.repositoryOwner, candidate.repositoryName));
    } else {
      remoteIndex = args.indexOf("origin", offset + 1);
      const cwd = await realpath(input.cwd);
      const owned = this.options.resolveExecutionProject?.(cwd);
      project = owned ? projects.find((candidate) => candidate.id === owned.id
        && candidate.repositoryOwner === owned.repositoryOwner && candidate.repositoryName === owned.repositoryName) : undefined;
      for (const candidate of projects) {
        if (project) break;
        const checkout = await resolveProjectCheckout(this.options.projectRoot, candidate).catch(() => null);
        if (checkout?.root === cwd) { project = candidate; break; }
      }
    }
    if (!project || remoteIndex < 0 || args.slice(0, offset).includes("-C")) {
      throw new ProjectProvisioningError("GIT_AUTH_FAILED", "GitHub App HTTPS authentication requires a registered repository and its validated checkout.");
    }
    if (!this.options.installationId) {
      throw new ProjectProvisioningError("GIT_AUTH_FAILED", "GitHub App HTTPS authentication requires a configured installation.");
    }
    let token: string;
    try {
      token = await this.options.tokens.getRepositoryToken(this.options.installationId, project.repositoryName);
    } catch {
      throw new ProjectProvisioningError("GIT_AUTH_FAILED", "GitHub App HTTPS token generation failed. Check installation access to this repository and Contents read/write permission.");
    }
    input.signal?.throwIfAborted();
    const url = `https://github.com/${project.repositoryOwner}/${project.repositoryName}.git`;
    args[remoteIndex] = url;
    if (operation === "fetch") {
      const branch = args[remoteIndex + 1];
      if (!branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch)) {
        throw new ProjectProvisioningError("GIT_AUTH_FAILED", "GitHub App HTTPS fetch requires an explicit base branch.");
      }
      // Fetching an explicit URL otherwise only updates FETCH_HEAD, not origin/*.
      args[remoteIndex + 1] = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
    }
    if (operation === "clone") args.splice(offset + 1, 0, "--no-checkout");
    else if (operation === "fetch" || operation === "push") args.splice(offset + 1, 0, "--no-recurse-submodules");
    const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
    const redact = (value: string) => value.split(token).join("[redacted]").split(encoded).join("[redacted]");
    // Per-process config: no token in argv, files, origin or long-lived agent env.
    const env: Record<string, string> = { ...input.env };
    for (const key of Object.keys(env)) {
      if (/^GIT_(?:CONFIG|TRACE|CURL|ASKPASS|SSH)|^SSH_ASKPASS/.test(key)) delete env[key];
    }
    const settings = [
      ["credential.helper", ""], ["core.hooksPath", "/dev/null"],
      ["http.followRedirects", "false"], ["http.sslVerify", "true"],
      ["http.extraHeader", ""], ["http.proxy", ""],
      ["maintenance.auto", "false"], ["gc.auto", "0"],
      [`http.${url}.extraHeader`, `Authorization: Basic ${encoded}`],
      ["protocol.allow", "never"], ["protocol.https.allow", "always"],
    ];
    Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: String(settings.length) });
    settings.forEach(([key, value], index) => { env[`GIT_CONFIG_KEY_${index}`] = key!; env[`GIT_CONFIG_VALUE_${index}`] = value!; });
    try {
      const result = await this.options.commands.run({ ...input, args, env,
        ...(input.onOutput ? { onOutput: (output) => input.onOutput!({ ...output, message: redact(output.message) }) } : {}),
      });
      const safe = { ...result, stdout: redact(result.stdout), stderr: redact(result.stderr) };
      if (result.exitCode !== 0 && /authentication failed|could not read username|403|401|repository not found|permission denied/i.test(safe.stderr)) {
        throw new ProjectProvisioningError("GIT_AUTH_FAILED", "GitHub App HTTPS credential rejected. Check repository installation access and Contents read/write permission.");
      }
      return safe;
    } catch (error) {
      if (error instanceof ProjectProvisioningError) throw error;
      if (input.signal?.aborted) input.signal.throwIfAborted();
      throw new Error("GitHub App HTTPS Git command failed; sensitive transport details withheld.");
    }
  }
}
