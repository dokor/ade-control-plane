import { createSign } from "node:crypto";

import type { InstallationTokenProvider } from "./client.js";

export interface GithubAppCredentials {
  appId: string;
  /** PEM private key, injected at runtime and never committed or logged. */
  privateKey: string;
}

export interface GithubAppTokenProviderOptions {
  credentials: GithubAppCredentials;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Renew before expiry so a token never expires mid-request. */
const RENEW_MARGIN_MS = 60_000;
const JWT_LIFETIME_SECONDS = 540;

/**
 * Mints short-lived GitHub App installation tokens.
 *
 * The App private key never leaves this process, tokens are cached only in
 * memory. Repository-scoped tokens can also authenticate worker-owned Git HTTPS
 * operations; the App private key and tokens must never reach agent processes.
 */
export class GithubAppTokenProvider implements InstallationTokenProvider {
  private readonly cache = new Map<string, CachedToken>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;

  public constructor(private readonly options: GithubAppTokenProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? Date.now;
  }

  public async getToken(installationId: string): Promise<string> {
    return this.tokenFor(installationId);
  }

  public async getRepositoryToken(installationId: string, repository: string): Promise<string> {
    if (!/^[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository name.");
    return this.tokenFor(installationId, repository);
  }

  private async tokenFor(installationId: string, repository?: string): Promise<string> {
    const key = `${installationId}:${repository ?? "*"}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - RENEW_MARGIN_MS > this.now()) {
      return cached.token;
    }

    const pending = this.pending.get(key);
    if (pending) return pending;

    const request = this.mintToken(installationId, key, repository).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  private async mintToken(installationId: string, key: string, repository?: string): Promise<string> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        ...(repository ? { body: JSON.stringify({ repositories: [repository], permissions: { contents: "write" } }) } : {}),
        headers: {
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          authorization: `Bearer ${this.createAppJwt()}`,
          "user-agent": "ade-control-plane",
          "x-github-api-version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `GitHub installation token request failed with status ${response.status}.`,
      );
    }

    const parsed = (await response.json()) as { token?: unknown; expires_at?: unknown };
    if (typeof parsed.token !== "string" || parsed.token.length === 0) {
      throw new Error("GitHub installation token response did not contain a token.");
    }

    const expiresAt =
      typeof parsed.expires_at === "string" ? Date.parse(parsed.expires_at) : Number.NaN;
    this.cache.set(key, {
      token: parsed.token,
      expiresAt: Number.isNaN(expiresAt) ? this.now() + RENEW_MARGIN_MS : expiresAt,
    });
    return parsed.token;
  }

  /** RS256 App JWT, per GitHub's App authentication contract. */
  public createAppJwt(): string {
    const issuedAt = Math.floor(this.now() / 1000) - 30;
    const header = encode({ alg: "RS256", typ: "JWT" });
    const payload = encode({
      iat: issuedAt,
      exp: issuedAt + JWT_LIFETIME_SECONDS,
      iss: this.options.credentials.appId,
    });
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(this.options.credentials.privateKey)
      .toString("base64url");
    return `${header}.${payload}.${signature}`;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
