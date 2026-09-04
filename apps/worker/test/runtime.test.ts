import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { loadV0WorkerRuntime } from "../src/v0/runtime.js";

test("passes only dedicated credentials to Codex", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ade-v0-runtime-"));
  try {
    const githubKey = join(directory, "github-key");
    const codexKey = join(directory, "codex-key");
    const codexHome = join(directory, "codex", ".codex");
    const gitHome = join(directory, "git");
    await writeFile(githubKey, "github-private-key", "utf8");
    await writeFile(codexKey, "codex-api-key", "utf8");
    const config = await loadV0WorkerRuntime({
      PATH: "/usr/bin",
      HOME: "/home/worker",
      DATABASE_URL: "postgres://secret",
      V0_PROJECT_ROOT: directory,
      DASHBOARD_PUBLIC_URL: "https://ade.example.com/path",
      GITHUB_APP_ID: "1",
      GITHUB_APP_INSTALLATION_ID: "2",
      GITHUB_APP_PRIVATE_KEY_FILE: githubKey,
      CODEX_API_KEY_FILE: codexKey,
      CODEX_HOME: codexHome,
      V0_GIT_HOME: gitHome,
      GIT_SSH: join(directory, "ade-git-ssh"),
      GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=no",
    });

    assert.equal(config.codexEnvironment.CODEX_API_KEY, "codex-api-key");
    assert.equal(config.codexEnvironment.DATABASE_URL, undefined);
    assert.equal(config.codexEnvironment.GITHUB_APP_PRIVATE_KEY_FILE, undefined);
    assert.equal(config.gitEnvironment.CODEX_API_KEY, undefined);
    assert.equal(config.adeExecutable, "ade");
    assert.equal(config.adeProfile, "normal");
    assert.equal(config.codexEnvironment.HOME, dirname(codexHome));
    assert.equal(config.gitEnvironment.HOME, gitHome);
    assert.equal(config.gitEnvironment.GIT_SSH, join(directory, "ade-git-ssh"));
    assert.equal(config.gitEnvironment.GIT_SSH_VARIANT, "ssh");
    assert.equal(config.gitEnvironment.GIT_TERMINAL_PROMPT, "0");
    assert.equal(config.gitEnvironment.GIT_SSH_COMMAND, undefined);
    assert.equal(config.codexEnvironment.GIT_SSH, undefined);
    assert.equal(config.claudeEnvironment.GIT_SSH, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts only ADE context profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ade-v0-runtime-profile-"));
  try {
    const githubKey = join(directory, "github-key");
    await writeFile(githubKey, "github-private-key", "utf8");
    const environment = {
      V0_PROJECT_ROOT: directory,
      DASHBOARD_PUBLIC_URL: "https://ade.example.com",
      GITHUB_APP_ID: "1",
      GITHUB_APP_INSTALLATION_ID: "2",
      GITHUB_APP_PRIVATE_KEY_FILE: githubKey,
      CODEX_HOME: join(directory, "codex"),
      V0_GIT_HOME: join(directory, "git"),
    };

    assert.equal((await loadV0WorkerRuntime({ ...environment, V0_ADE_PROFILE: "expert" })).adeProfile, "expert");
    await assert.rejects(
      () => loadV0WorkerRuntime({ ...environment, V0_ADE_PROFILE: "agent" }),
      /V0_ADE_PROFILE must be chill, normal, or expert/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selects Claude Code explicitly and keeps its credential isolated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ade-v0-runtime-agent-"));
  try {
    const githubKey = join(directory, "github-key");
    const anthropicKey = join(directory, "anthropic-key");
    await writeFile(githubKey, "github-private-key", "utf8");
    await writeFile(anthropicKey, "anthropic-api-key", "utf8");
    const config = await loadV0WorkerRuntime({
      V0_PROJECT_ROOT: directory,
      DASHBOARD_PUBLIC_URL: "https://ade.example.com",
      GITHUB_APP_ID: "1",
      GITHUB_APP_INSTALLATION_ID: "2",
      GITHUB_APP_PRIVATE_KEY_FILE: githubKey,
      ANTHROPIC_API_KEY_FILE: anthropicKey,
      V0_AGENT_PROVIDER: "claude-code",
      CODEX_HOME: join(directory, "codex"),
      V0_GIT_HOME: join(directory, "git"),
    });

    assert.equal(config.agentProvider, "claude-code");
    assert.equal(config.claudeEnvironment.ANTHROPIC_API_KEY, "anthropic-api-key");
    assert.equal(config.codexEnvironment.ANTHROPIC_API_KEY, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts only WebSocket App Server URLs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ade-v0-runtime-url-"));
  try {
    const githubKey = join(directory, "github-key");
    await writeFile(githubKey, "github-private-key", "utf8");
    const config = await loadV0WorkerRuntime({
      V0_PROJECT_ROOT: directory,
      DASHBOARD_PUBLIC_URL: "https://ade.example.com",
      GITHUB_APP_ID: "1",
      GITHUB_APP_INSTALLATION_ID: "2",
      GITHUB_APP_PRIVATE_KEY_FILE: githubKey,
      CODEX_HOME: join(directory, "codex"),
      V0_GIT_HOME: join(directory, "git"),
      CODEX_APP_SERVER_URL: "ws://127.0.0.1:4500",
    });

    assert.equal(config.codexAppServerUrl, "ws://127.0.0.1:4500/");
    await assert.rejects(
      () => loadV0WorkerRuntime({
        V0_PROJECT_ROOT: directory,
        DASHBOARD_PUBLIC_URL: "https://ade.example.com",
        GITHUB_APP_ID: "1",
        GITHUB_APP_INSTALLATION_ID: "2",
        GITHUB_APP_PRIVATE_KEY_FILE: githubKey,
        CODEX_HOME: join(directory, "codex"),
        V0_GIT_HOME: join(directory, "git"),
        CODEX_APP_SERVER_URL: "http://127.0.0.1:4500",
      }),
      /CODEX_APP_SERVER_URL must use ws:\/\/ or wss:\/\//,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
