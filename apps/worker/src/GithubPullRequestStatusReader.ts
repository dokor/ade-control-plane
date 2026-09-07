import type { GithubRepositoryRef, InstallationTokenProvider } from "@ade-control-plane/github";

export interface GithubPullRequestStatus {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  headRef: string;
  baseRef: string;
}

export interface GithubPullRequestStatusReader {
  get(repository: GithubRepositoryRef, pullRequestNumber: number): Promise<GithubPullRequestStatus | null>;
}

export interface HttpGithubPullRequestStatusReaderOptions {
  tokens: InstallationTokenProvider;
  installationId: string;
  baseUrl?: string;
  userAgent?: string;
  fetchImplementation?: typeof fetch;
}

/** Read-only PR state used by periodic reconciliation when a webhook was missed. */
export class HttpGithubPullRequestStatusReader implements GithubPullRequestStatusReader {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: HttpGithubPullRequestStatusReaderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    this.userAgent = options.userAgent ?? "ade-control-plane";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  public async get(repository: GithubRepositoryRef, pullRequestNumber: number): Promise<GithubPullRequestStatus | null> {
    if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) return null;
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls/${pullRequestNumber}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": this.userAgent,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub pull request reconciliation failed with status ${response.status}.`);
    const value: unknown = await response.json().catch(() => null);
    if (!isRecord(value) || value.number !== pullRequestNumber || (value.state !== "open" && value.state !== "closed") ||
        !isRecord(value.head) || typeof value.head.ref !== "string" || !isRecord(value.base) || typeof value.base.ref !== "string") {
      throw new Error("GitHub pull request reconciliation returned an invalid response.");
    }
    return {
      number: pullRequestNumber,
      state: value.state,
      merged: value.merged === true || typeof value.merged_at === "string",
      headRef: value.head.ref,
      baseRef: value.base.ref,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
