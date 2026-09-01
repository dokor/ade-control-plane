import { readFile } from "node:fs/promises";

export interface DashboardConfig {
  sessionSecret: string;
  sessionTtlMs: number;
  operatorPasswordHash: string;
  operatorRef: string;
  publicOrigin: string;
  cookieSecure: boolean;
  quotaProvider: string;
  quotaAccountRef: string;
  refreshIntervalMs: number;
  adeRuntimeVersion: string;
}

/**
 * Secrets are read from `*_FILE` paths first so container/Compose secrets stay
 * out of the process environment dump. Inline variables remain supported for
 * local development only.
 */
async function readSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  required: boolean,
): Promise<string> {
  const filePath = env[`${name}_FILE`]?.trim();
  if (filePath) {
    const contents = (await readFile(filePath, "utf8")).trim();
    if (contents) return contents;
  }

  const inline = env[name]?.trim();
  if (inline) return inline;

  if (required) {
    throw new Error(`${name} or ${name}_FILE must be set.`);
  }
  return "";
}

export async function loadDashboardConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DashboardConfig> {
  const publicUrl = env.DASHBOARD_PUBLIC_URL?.trim() ?? "http://localhost:3000";
  const origin = new URL(publicUrl).origin;

  return {
    sessionSecret: await readSecret(env, "DASHBOARD_SESSION_SECRET", true),
    operatorPasswordHash: await readSecret(env, "DASHBOARD_PASSWORD_HASH", true),
    sessionTtlMs: positiveNumber(env.DASHBOARD_SESSION_TTL_MINUTES, 720) * 60_000,
    operatorRef: env.DASHBOARD_OPERATOR_REF?.trim() || "operator",
    publicOrigin: origin,
    cookieSecure: origin.startsWith("https://"),
    quotaProvider: env.QUOTA_PROVIDER?.trim() || "openai",
    quotaAccountRef: env.CODEX_CREDENTIAL_REF?.trim() || "codex-account-main",
    refreshIntervalMs: positiveNumber(env.DASHBOARD_REFRESH_SECONDS, 300) * 1_000,
    adeRuntimeVersion: env.ADE_RUNTIME_VERSION?.trim() || "unknown",
  };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
