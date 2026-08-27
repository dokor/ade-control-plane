import type { GithubRepositoryRef } from "./domain.js";

export interface GithubComment {
  id: string;
  body: string;
}

/**
 * The narrow GitHub surface the control plane needs.
 *
 * Only issue/PR comments are written. There is deliberately no method for
 * contents, workflows, secrets or administration, so a bug in the adapter
 * cannot reach a permission the integration should never hold.
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

  public constructor(status: number, action: string) {
    // The GitHub response body may echo request content; only the status is kept.
    super(`GitHub API ${action} failed with status ${status}.`);
    this.name = "GithubApiError";
    this.status = status;
  }
}

export class HttpGithubClient implements GithubClient {
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
}

/** Deterministic double used by tests and local runs without GitHub access. */
export class DeterministicFakeGithubClient implements GithubClient {
  public readonly created: { issueNumber: number; body: string }[] = [];
  public readonly updated: { commentId: string; body: string }[] = [];

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
}
