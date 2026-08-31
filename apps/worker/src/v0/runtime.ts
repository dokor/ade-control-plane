import { readFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export interface V0WorkerRuntimeConfig {
  projectRoot: string;
  codexExecutable: string;
  adeExecutable: string;
  adeProfile: "chill" | "normal" | "expert";
  codexEnvironment: Readonly<Record<string, string>>;
  gitEnvironment: Readonly<Record<string, string>>;
  codexAppServerUrl: string | null;
  quotaAccountRef: string;
  taskTimeoutMs: number;
  idleDelayMs: number;
  dashboardUrl: string;
  adeRuntimeVersion: string;
  github: {
    appId: string;
    installationId: string;
    privateKey: string;
  };
}

export async function loadV0WorkerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<V0WorkerRuntimeConfig> {
  const projectRoot = requiredAbsolute(env.V0_PROJECT_ROOT, "V0_PROJECT_ROOT");
  const appId = required(env.GITHUB_APP_ID, "GITHUB_APP_ID");
  const installationId = required(
    env.GITHUB_APP_INSTALLATION_ID,
    "GITHUB_APP_INSTALLATION_ID",
  );
  const privateKey = await readSecret(env, "GITHUB_APP_PRIVATE_KEY");
  if (!privateKey) throw new Error("GITHUB_APP_PRIVATE_KEY_FILE must reference a secret.");
  const codexApiKey = await readSecret(env, "CODEX_API_KEY");
  const codexHome = requiredAbsolute(env.CODEX_HOME, "CODEX_HOME");
  const gitHome = requiredAbsolute(env.V0_GIT_HOME, "V0_GIT_HOME");
  const codexAppServerUrl = optionalWebSocketUrl(env.CODEX_APP_SERVER_URL);
  const dashboardUrl = requiredHttpUrl(env.DASHBOARD_PUBLIC_URL, "DASHBOARD_PUBLIC_URL");

  const childBase = safeChildEnvironment(env);
  const codexEnvironment = {
    ...childBase,
    HOME: dirname(codexHome),
    CODEX_HOME: codexHome,
    ...(codexApiKey ? { CODEX_API_KEY: codexApiKey } : {}),
  };
  return {
    projectRoot,
    codexExecutable: env.CODEX_EXECUTABLE?.trim() || "codex",
    adeExecutable: env.ADE_EXECUTABLE?.trim() || "ade",
    adeProfile: adeProfile(env.V0_ADE_PROFILE),
    codexEnvironment,
    gitEnvironment: {
      ...childBase,
      HOME: gitHome,
      ...(env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: env.SSH_AUTH_SOCK } : {}),
      GIT_CONFIG_NOSYSTEM: "1",
    },
    codexAppServerUrl,
    quotaAccountRef: env.CODEX_CREDENTIAL_REF?.trim() || "codex-account-main",
    taskTimeoutMs: positiveInteger(env.V0_TASK_TIMEOUT_SECONDS, 3_600) * 1_000,
    idleDelayMs: positiveInteger(env.V0_WORKER_IDLE_SECONDS, 2) * 1_000,
    dashboardUrl,
    adeRuntimeVersion: env.ADE_RUNTIME_VERSION?.trim() || "unknown",
    github: { appId, installationId, privateKey },
  };
}

function adeProfile(value: string | undefined): "chill" | "normal" | "expert" {
  const profile = value?.trim() || "normal";
  if (profile === "chill" || profile === "normal" || profile === "expert") return profile;
  throw new Error("V0_ADE_PROFILE must be chill, normal, or expert.");
}

function optionalWebSocketUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("CODEX_APP_SERVER_URL must be a valid ws:// or wss:// URL.");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("CODEX_APP_SERVER_URL must use ws:// or wss://.");
  }
  return url.toString();
}

function safeChildEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const name of [
    "PATH",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
  ]) {
    const value = env[name];
    if (value) safe[name] = value;
  }
  return safe;
}

async function readSecret(
  env: NodeJS.ProcessEnv,
  name: string,
): Promise<string | null> {
  const filePath = env[`${name}_FILE`]?.trim();
  if (filePath) {
    const value = (await readFile(filePath, "utf8")).trim();
    return value || null;
  }
  return env[name]?.trim() || null;
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} must be set.`);
  return trimmed;
}

function requiredAbsolute(value: string | undefined, name: string): string {
  const path = required(value, name);
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path.`);
  return path;
}

function requiredHttpUrl(value: string | undefined, name: string): string {
  const raw = required(value, name);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http:// or https://.`);
  }
  return parsed.origin;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("V0 worker duration configuration must be a positive integer.");
  }
  return parsed;
}
