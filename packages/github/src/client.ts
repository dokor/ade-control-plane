import type { GithubRepositoryRef } from "./domain.js";

export interface GithubComment {
  id: string;
  body: string;
}

export interface GithubPullRequestInput {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface GithubPullRequest {
  number: number;
  url: string;
  head: string;
  base: string;
}

export interface GithubPullRequestClient {
  createPullRequest(
    repository: GithubRepositoryRef,
    input: GithubPullRequestInput,
  ): Promise<GithubPullRequest>;
  findPullRequest?(
    repository: GithubRepositoryRef,
    head: string,
    base: string,
  ): Promise<GithubPullRequest | null>;
}

/**
 * The narrow GitHub surface the control plane needs.
 *
 * Only issue/PR comments are written by this interface. Pull request creation
 * is exposed separately; neither surface grants contents, workflows, secrets
 * or administration access.
 */
export interface GithubClient {
  createComment(
    repository: GithubRepositoryRef,
    issueNumber: number,
    body: string,
  ): Promise<GithubComment>;
  updateComment(
    repository: GithubRepositoryRef,
    commentId: string,
    body: string,
  ): Promise<GithubComment>;
}

export interface InstallationTokenProvider {
  getToken(installationId: string): Promise<string>;
}

export interface HttpGithubClientOptions {
  tokens: InstallationTokenProvider;
  installationId: string;
  baseUrl?: string;
  userAgent?: string;
  fetchImplementation?: typeof fetch;
}

export class GithubApiError extends Error {
  public readonly status: number;
  public readonly detail: string | null;

  public constructor(status: number, action: string, detail: string | null = null) {
    // The GitHub response body may echo request content; only the status is kept.
    super(`GitHub API ${action} failed with status ${status}.`);
    this.name = "GithubApiError";
    this.status = status;
    this.detail = detail;
  }
}

export class HttpGithubClient implements GithubClient, GithubPullRequestClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: HttpGithubClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    this.userAgent = options.userAgent ?? "ade-control-plane";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  public async createComment(
    repository: GithubRepositoryRef,
    issueNumber: number,
    body: string,
  ): Promise<GithubComment> {
    return this.request(
      "POST",
      `/repos/${repository.owner}/${repository.name}/issues/${issueNumber}/comments`,
      body,
      "create comment",
    );
  }

  public async updateComment(
    repository: GithubRepositoryRef,
    commentId: string,
    body: string,
  ): Promise<GithubComment> {
    return this.request(
      "PATCH",
      `/repos/${repository.owner}/${repository.name}/issues/comments/${commentId}`,
      body,
      "update comment",
    );
  }

  public async createPullRequest(
    repository: GithubRepositoryRef,
    input: GithubPullRequestInput,
  ): Promise<GithubPullRequest> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${repository.owner}/${repository.name}/pulls`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "user-agent": this.userAgent,
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify(input),
      },
    );

    if (!response.ok) {
      throw new GithubApiError(response.status, "create pull request", await safeGithubErrorDetail(response));
    }

    const parsed = (await response.json()) as {
      number?: unknown;
      html_url?: unknown;
      head?: { ref?: unknown };
      base?: { ref?: unknown };
    };
    if (
      !Number.isInteger(parsed.number) ||
      typeof parsed.html_url !== "string" ||
      parsed.html_url.length === 0
    ) {
      throw new Error("GitHub pull request response is invalid.");
    }

    return {
      number: Number(parsed.number),
      url: parsed.html_url,
      head: typeof parsed.head?.ref === "string" ? parsed.head.ref : input.head,
      base: typeof parsed.base?.ref === "string" ? parsed.base.ref : input.base,
    };
  }

  public async findPullRequest(
    repository: GithubRepositoryRef,
    head: string,
    base: string,
  ): Promise<GithubPullRequest | null> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?state=open&head=${encodeURIComponent(`${repository.owner}:${head}`)}&base=${encodeURIComponent(base)}&per_page=20`,
      { headers: this.headers(token) },
    );
    if (!response.ok) throw new GithubApiError(response.status, "find pull request", await safeGithubErrorDetail(response));
    const parsed: unknown = await response.json().catch(() => null);
    if (!Array.isArray(parsed)) throw new Error("GitHub pull request list response is invalid.");
    for (const value of parsed) {
      const candidate = normalizePullRequest(value, head, base);
      if (candidate) return candidate;
    }
    return null;
  }

  private async request(
    method: "POST" | "PATCH",
    path: string,
    body: string,
    action: string,
  ): Promise<GithubComment> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": this.userAgent,
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      throw new GithubApiError(response.status, action);
    }

    const parsed = (await response.json()) as { id?: unknown; body?: unknown };
    return {
      id: String(parsed.id ?? ""),
      body: typeof parsed.body === "string" ? parsed.body : body,
    };
  }

  private headers(token: string): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": this.userAgent,
      "x-github-api-version": "2022-11-28",
    };
  }
}

function normalizePullRequest(value: unknown, head: string, base: string): GithubPullRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as { number?: unknown; html_url?: unknown; head?: { ref?: unknown }; base?: { ref?: unknown } };
  if (!Number.isInteger(candidate.number) || typeof candidate.html_url !== "string" || !isGithubUrl(candidate.html_url) || candidate.head?.ref !== head || candidate.base?.ref !== base) return null;
  return { number: Number(candidate.number), url: candidate.html_url, head, base };
}

function isGithubUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "github.com"; } catch { return false; }
}

async function safeGithubErrorDetail(response: Response): Promise<string | null> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  for (const error of errors) {
    if (typeof error !== "object" || error === null || Array.isArray(error)) continue;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && /^[a-zA-Z0-9 .,:'()/_#-]{1,240}$/u.test(message)) return message;
  }
  return null;
}

/** Deterministic double used by tests and local runs without GitHub access. */
export class DeterministicFakeGithubClient
  implements GithubClient, GithubPullRequestClient
{
  public readonly created: { issueNumber: number; body: string }[] = [];
  public readonly updated: { commentId: string; body: string }[] = [];
  public readonly createdPullRequests: {
    repository: GithubRepositoryRef;
    input: GithubPullRequestInput;
  }[] = [];

  private nextId = 1;

  public async createComment(
    _repository: GithubRepositoryRef,
    issueNumber: number,
    body: string,
  ): Promise<GithubComment> {
    this.created.push({ issueNumber, body });
    return { id: `fake-comment-${this.nextId++}`, body };
  }

  public async updateComment(
    _repository: GithubRepositoryRef,
    commentId: string,
    body: string,
  ): Promise<GithubComment> {
    this.updated.push({ commentId, body });
    return { id: commentId, body };
  }

  public async createPullRequest(
    repository: GithubRepositoryRef,
    input: GithubPullRequestInput,
  ): Promise<GithubPullRequest> {
    this.createdPullRequests.push({ repository, input });
    return {
      number: this.nextId++,
      url: `https://github.com/${repository.owner}/${repository.name}/pull/fake`,
      head: input.head,
      base: input.base,
    };
  }
}
