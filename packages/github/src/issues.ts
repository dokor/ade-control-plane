import type { GithubRepositoryRef } from "./domain.js";
import type { InstallationTokenProvider } from "./client.js";

const MAX_ISSUE_TITLE_LENGTH = 500;
const DEFAULT_MAX_PAGES = 10;

export interface GithubIssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  updatedAt: string;
}

export interface GithubIssueReader {
  listIssues(repository: GithubRepositoryRef): Promise<readonly GithubIssueSummary[]>;
  getIssue(repository: GithubRepositoryRef, issueNumber: number): Promise<GithubIssueSummary | null>;
}

export interface GithubIssueDetails extends GithubIssueSummary {
  body: string;
  labels: readonly string[];
}

export interface GithubIssueLifecycleClient {
  getIssueDetails(repository: GithubRepositoryRef, issueNumber: number): Promise<GithubIssueDetails | null>;
  updateIssueBody(repository: GithubRepositoryRef, issueNumber: number, body: string): Promise<GithubIssueDetails>;
  /** Replaces only Control Plane-owned workflow labels and preserves project labels. */
  syncAdeWorkflowLabels(repository: GithubRepositoryRef, issueNumber: number, labels: readonly string[]): Promise<GithubIssueDetails>;
}

export interface HttpGithubIssueAdapterOptions {
  tokens: InstallationTokenProvider;
  installationId: string;
  baseUrl?: string;
  userAgent?: string;
  fetchImplementation?: typeof fetch;
  maxPages?: number;
}

/**
 * Read-only GitHub issue metadata for human-facing surfaces.
 *
 * This is intentionally separate from GithubWorkReader: work metadata remains
 * a strict machine contract, while the Dashboard may display a bounded title.
 * Issue bodies, comments and labels never leave this adapter.
 */
export class HttpGithubIssueAdapter implements GithubIssueReader {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxPages: number;

  public constructor(private readonly options: HttpGithubIssueAdapterOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    this.userAgent = options.userAgent ?? "ade-control-plane";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.maxPages = positiveInteger(options.maxPages, DEFAULT_MAX_PAGES);
  }

  public async listIssues(
    repository: GithubRepositoryRef,
  ): Promise<readonly GithubIssueSummary[]> {
    const issues = new Map<number, GithubIssueSummary>();
    for (let page = 1; page <= this.maxPages; page += 1) {
      const response = await this.request(
        `/repos/${encode(repository.owner)}/${encode(repository.name)}/issues?state=all&per_page=100&sort=updated&direction=desc&page=${page}`,
      );
      if (!response.ok) throw new GithubIssueAdapterError(response.status, "list issues");
      const payload = await response.json().catch(() => null);
      if (!Array.isArray(payload)) {
        throw new GithubIssueAdapterError(502, "validate issue list");
      }
      for (const value of payload) {
        const issue = normalizeGithubIssueSummary(value, repository);
        if (issue) issues.set(issue.number, issue);
      }
      if (payload.length < 100) break;
    }
    return [...issues.values()].toSorted((left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.number - right.number,
    );
  }

  public async getIssue(
    repository: GithubRepositoryRef,
    issueNumber: number,
  ): Promise<GithubIssueSummary | null> {
    if (!Number.isInteger(issueNumber) || issueNumber < 1) return null;
    const response = await this.request(
      `/repos/${encode(repository.owner)}/${encode(repository.name)}/issues/${issueNumber}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new GithubIssueAdapterError(response.status, "read issue");
    return normalizeGithubIssueSummary(await response.json().catch(() => null), repository);
  }

  private async request(path: string): Promise<Response> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    return this.fetchImplementation(`${this.baseUrl}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": this.userAgent,
        "x-github-api-version": "2022-11-28",
      },
    });
  }
}

export class GithubIssueAdapterError extends Error {
  public constructor(public readonly status: number, action: string) {
    super(`GitHub API ${action} failed with status ${status}.`);
    this.name = "GithubIssueAdapterError";
  }
}

export function normalizeGithubIssueSummary(
  value: unknown,
  repository: GithubRepositoryRef,
): GithubIssueSummary | null {
  if (!isRecord(value) || "pull_request" in value) return null;
  const number = value.number;
  const title = value.title;
  const state = value.state;
  const url = value.html_url;
  const updatedAt = value.updated_at;
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1 ||
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > MAX_ISSUE_TITLE_LENGTH ||
    (state !== "open" && state !== "closed") ||
    typeof url !== "string" ||
    !isGithubIssueUrl(url, repository) ||
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt))
  ) return null;
  return {
    number,
    title,
    state,
    url,
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

function isGithubIssueUrl(value: string, repository: GithubRepositoryRef): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname === `/` + repository.owner + `/` + repository.name + `/issues/` +
        url.pathname.split("/").at(-1) &&
      /^\/[^/]+\/[^/]+\/issues\/\d+$/u.test(url.pathname);
  } catch {
    return false;
  }
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
