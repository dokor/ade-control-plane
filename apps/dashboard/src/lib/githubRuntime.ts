import { readFile } from "node:fs/promises";

import {
  GithubAppTokenProvider,
  HttpGithubClient,
  HttpGithubWorkAdapter,
  parseActorIdList,
  type GithubAuthorizationPolicy,
  type GithubClient,
  type GithubWorkReader,
} from "@ade-control-plane/github";

import { loadDashboardConfig } from "./config.js";

export interface GithubRuntime {
  webhookSecret: string;
  policy: GithubAuthorizationPolicy;
  dashboardUrl: string;
  quotaProvider: string;
  quotaAccountRef: string;
  /** Undefined when no App credential is configured: the bot then stays silent. */
  client: GithubClient | undefined;
  /** Repository-scoped reader used only after a verified GitHub delivery. */
  workReader: GithubWorkReader | undefined;
}

let cached: Promise<GithubRuntime | null> | null = null;

/**
 * Builds the GitHub integration from runtime configuration.
 *
 * Returns `null` when no webhook secret is configured, so an unconfigured
 * deployment answers 503 rather than accepting unverifiable deliveries.
 */
export function loadGithubRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GithubRuntime | null> {
  cached ??= build(env);
  return cached;
}

async function build(env: NodeJS.ProcessEnv): Promise<GithubRuntime | null> {
  const webhookSecret = await readSecret(env, "GITHUB_WEBHOOK_SECRET");
  if (!webhookSecret) return null;

  const config = await loadDashboardConfig(env);
  const policy: GithubAuthorizationPolicy = {
    allowedActorIds: parseActorIdList(env.GITHUB_ALLOWED_ACTOR_IDS),
    allowedInstallationIds: parseActorIdList(env.GITHUB_ALLOWED_INSTALLATION_IDS),
  };

  return {
    webhookSecret,
    policy,
    dashboardUrl: config.publicOrigin,
    quotaProvider: config.quotaProvider,
    quotaAccountRef: config.quotaAccountRef,
    client: await buildClient(env),
    workReader: await buildWorkReader(env),
  };
}

async function buildWorkReader(env: NodeJS.ProcessEnv): Promise<GithubWorkReader | undefined> {
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKey = await readSecret(env, "GITHUB_APP_PRIVATE_KEY");
  if (!appId || !installationId || !privateKey) return undefined;
  return new HttpGithubWorkAdapter({
    tokens: new GithubAppTokenProvider({ credentials: { appId, privateKey } }),
    installationId,
  });
}

async function buildClient(
  env: NodeJS.ProcessEnv,
): Promise<GithubClient | undefined> {
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKey = await readSecret(env, "GITHUB_APP_PRIVATE_KEY");
  if (!appId || !installationId || !privateKey) return undefined;

  return new HttpGithubClient({
    tokens: new GithubAppTokenProvider({ credentials: { appId, privateKey } }),
    installationId,
  });
}

/** Prefers `*_FILE` so container secrets stay out of the environment dump. */
async function readSecret(
  env: NodeJS.ProcessEnv,
  name: string,
): Promise<string | null> {
  const filePath = env[`${name}_FILE`]?.trim();
  if (filePath) {
    const contents = (await readFile(filePath, "utf8").catch(() => "")).trim();
    if (contents) return contents;
  }
  return env[name]?.trim() || null;
}
