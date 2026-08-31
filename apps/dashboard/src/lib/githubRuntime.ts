import { readFile } from "node:fs/promises";

import {
  GithubAppTokenProvider,
  HttpGithubClient,
  HttpGithubIssueAdapter,
  HttpGithubWorkAdapter,
  parseActorIdList,
  type GithubAuthorizationPolicy,
  type GithubClient,
  type GithubIssueReader,
  type GithubWorkReader,
} from "@ade-control-plane/github";

import { loadDashboardConfig } from "./config.js";

export interface GithubRuntime {
  webhookSecret: string | null;
  policy: GithubAuthorizationPolicy;
  dashboardUrl: string;
  quotaProvider: string;
  quotaAccountRef: string;
  /** Undefined when no App credential is configured: the bot then stays silent. */
  client: GithubClient | undefined;
  /** Repository-scoped reader used only after a verified GitHub delivery. */
  workReader: GithubWorkReader | undefined;
  issueReader: GithubIssueReader | undefined;
}

let cached: Promise<GithubRuntime | null> | null = null;

/**
 * Builds the GitHub integration from runtime configuration.
 *
 * Returns `null` when neither webhook verification nor GitHub App access is
 * configured. The authenticated issue API only needs the latter.
 */
export function loadGithubRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GithubRuntime | null> {
  cached ??= build(env);
  return cached;
}

async function build(env: NodeJS.ProcessEnv): Promise<GithubRuntime | null> {
  const webhookSecret = await readSecret(env, "GITHUB_WEBHOOK_SECRET");
  const config = await loadDashboardConfig(env);
  const client = await buildClient(env);
  const workReader = await buildWorkReader(env);
  const issueReader = await buildIssueReader(env);
  if (!webhookSecret && !client && !workReader && !issueReader) return null;
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
    client,
    workReader,
    issueReader,
  };
}

async function buildIssueReader(env: NodeJS.ProcessEnv): Promise<GithubIssueReader | undefined> {
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKey = await readSecret(env, "GITHUB_APP_PRIVATE_KEY");
  if (!appId || !installationId || !privateKey) return undefined;
  return new HttpGithubIssueAdapter({
    tokens: new GithubAppTokenProvider({ credentials: { appId, privateKey } }),
    installationId,
  });
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
