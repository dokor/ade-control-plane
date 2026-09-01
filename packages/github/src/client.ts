import type { GithubRepositoryRef } from "./domain.js";
import type { GithubIssueDetails, GithubIssueLifecycleClient } from "./issues.js";

export interface GithubRepositoryContent {
  path: string;
  sha: string;
  content: string;
}

export interface GithubRepositoryMetadata {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}

export interface GithubLabel {
  name: string;
  color?: string;
  description?: string;
}

export interface GithubSetupPullRequestInput {
  files: Readonly<Record<string, string>>;
  title: string;
  body: string;
  baseBranch?: string;
}

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

/** Explicit, repository-scoped setup operations used by the Dashboard. */
export interface GithubSetupClient {
  getRepositoryMetadata(repository: GithubRepositoryRef): Promise<GithubRepositoryMetadata>;
  getRepositoryContent(
    repository: GithubRepositoryRef,
    path: string,
  ): Promise<GithubRepositoryContent | null>;
  listLabels(repository: GithubRepositoryRef): Promise<readonly GithubLabel[]>;
  createLabel(repository: GithubRepositoryRef, label: GithubLabel): Promise<GithubLabel>;
  findOpenSetupPullRequest(repository: GithubRepositoryRef, title: string): Promise<GithubPullRequest | null>;
  createSetupPullRequest(
    repository: GithubRepositoryRef,
    input: GithubSetupPullRequestInput,
  ): Promise<GithubPullRequest>;
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

export class HttpGithubClient implements GithubClient, GithubPullRequestClient, GithubSetupClient, GithubIssueLifecycleClient {
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

  public async getIssueDetails(repository: GithubRepositoryRef, issueNumber: number): Promise<GithubIssueDetails | null> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(`${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${issueNumber}`, { headers: this.headers(token) });
    if (response.status === 404) return null;
    if (!response.ok) throw new GithubApiError(response.status, "read issue", await safeGithubErrorDetail(response));
    return normalizeIssueDetails(await response.json().catch(() => null), repository);
  }

  public async updateIssueBody(repository: GithubRepositoryRef, issueNumber: number, body: string): Promise<GithubIssueDetails> {
    if (new TextEncoder().encode(body).byteLength > 32 * 1024) throw new Error("GitHub issue body exceeds the ADE lifecycle limit.");
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(`${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${issueNumber}`, {
      method: "PATCH", headers: { ...this.headers(token), "content-type": "application/json" }, body: JSON.stringify({ body }),
    });
    if (!response.ok) throw new GithubApiError(response.status, "update issue", await safeGithubErrorDetail(response));
    const issue = normalizeIssueDetails(await response.json().catch(() => null), repository);
    if (!issue) throw new Error("GitHub issue response is invalid.");
    return issue;
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

  public async getRepositoryContent(
    repository: GithubRepositoryRef,
    path: string,
  ): Promise<GithubRepositoryContent | null> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      { headers: this.headers(token) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new GithubApiError(response.status, "read repository content", await safeGithubErrorDetail(response));
    const parsed = (await response.json().catch(() => null)) as { type?: unknown; path?: unknown; sha?: unknown; content?: unknown } | null;
    if (!parsed || parsed.type !== "file" || typeof parsed.path !== "string" || typeof parsed.sha !== "string" || typeof parsed.content !== "string") {
      throw new Error("GitHub repository content response is invalid.");
    }
    return { path: parsed.path, sha: parsed.sha, content: parsed.content };
  }

  public async getRepositoryMetadata(repository: GithubRepositoryRef): Promise<GithubRepositoryMetadata> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      { headers: this.headers(token) },
    );
    if (!response.ok) throw new GithubApiError(response.status, "read repository metadata", await safeGithubErrorDetail(response));
    const parsed = (await response.json().catch(() => null)) as { id?: unknown; owner?: { login?: unknown }; name?: unknown; default_branch?: unknown; private?: unknown; html_url?: unknown } | null;
    if (!parsed || (typeof parsed.id !== "number" && typeof parsed.id !== "string") || typeof parsed.owner?.login !== "string" || typeof parsed.name !== "string" || typeof parsed.default_branch !== "string" || typeof parsed.private !== "boolean" || typeof parsed.html_url !== "string") {
      throw new Error("GitHub repository metadata response is invalid.");
    }
    return { id: String(parsed.id), owner: parsed.owner.login, name: parsed.name, defaultBranch: parsed.default_branch, private: parsed.private, url: parsed.html_url };
  }

  public async listLabels(repository: GithubRepositoryRef): Promise<readonly GithubLabel[]> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/labels?per_page=100`,
      { headers: this.headers(token) },
    );
    if (!response.ok) throw new GithubApiError(response.status, "list repository labels", await safeGithubErrorDetail(response));
    const parsed: unknown = await response.json().catch(() => null);
    if (!Array.isArray(parsed)) throw new Error("GitHub labels response is invalid.");
    return parsed.flatMap((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
      const label = value as { name?: unknown; color?: unknown; description?: unknown };
      return typeof label.name === "string" && label.name.length > 0
        ? [{ name: label.name, ...(typeof label.color === "string" ? { color: label.color } : {}), ...(typeof label.description === "string" ? { description: label.description } : {}) }]
        : [];
    });
  }

  public async createLabel(repository: GithubRepositoryRef, label: GithubLabel): Promise<GithubLabel> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/labels`,
      {
        method: "POST",
        headers: { ...this.headers(token), "content-type": "application/json" },
        body: JSON.stringify({ name: label.name, color: label.color ?? "1d76db", description: label.description ?? "ADE workflow label" }),
      },
    );
    if (!response.ok) throw new GithubApiError(response.status, "create repository label", await safeGithubErrorDetail(response));
    const parsed = (await response.json().catch(() => null)) as { name?: unknown; color?: unknown; description?: unknown } | null;
    if (!parsed || typeof parsed.name !== "string") throw new Error("GitHub label response is invalid.");
    return { name: parsed.name, ...(typeof parsed.color === "string" ? { color: parsed.color } : {}), ...(typeof parsed.description === "string" ? { description: parsed.description } : {}) };
  }

  public async createSetupPullRequest(
    repository: GithubRepositoryRef,
    input: GithubSetupPullRequestInput,
  ): Promise<GithubPullRequest> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const repositoryUrl = `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const repositoryResponse = await this.fetchImplementation(repositoryUrl, { headers: this.headers(token) });
    if (!repositoryResponse.ok) throw new GithubApiError(repositoryResponse.status, "read repository", await safeGithubErrorDetail(repositoryResponse));
    const repositoryPayload = (await repositoryResponse.json().catch(() => null)) as { default_branch?: unknown } | null;
    const base = typeof repositoryPayload?.default_branch === "string" ? repositoryPayload.default_branch : input.baseBranch ?? "main";
    const refResponse = await this.fetchImplementation(`${repositoryUrl}/git/ref/heads/${encodeURIComponent(base)}`, { headers: this.headers(token) });
    if (!refResponse.ok) throw new GithubApiError(refResponse.status, "read repository branch", await safeGithubErrorDetail(refResponse));
    const refPayload = (await refResponse.json().catch(() => null)) as { object?: { sha?: unknown } } | null;
    const baseSha = typeof refPayload?.object?.sha === "string" ? refPayload.object.sha : null;
    if (!baseSha) throw new Error("GitHub branch response is invalid.");

    const blobs = [] as { path: string; sha: string }[];
    for (const [path, content] of Object.entries(input.files)) {
      if (!/^\.?[A-Za-z0-9_./-]+$/u.test(path) || path.startsWith("/") || path.includes("..")) throw new Error("Setup file path is invalid.");
      const blobResponse = await this.fetchImplementation(`${repositoryUrl}/git/blobs`, {
        method: "POST", headers: { ...this.headers(token), "content-type": "application/json" },
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      if (!blobResponse.ok) throw new GithubApiError(blobResponse.status, "create setup file blob", await safeGithubErrorDetail(blobResponse));
      const blobPayload = (await blobResponse.json().catch(() => null)) as { sha?: unknown } | null;
      if (typeof blobPayload?.sha !== "string") throw new Error("GitHub blob response is invalid.");
      blobs.push({ path, sha: blobPayload.sha });
    }

    const treeResponse = await this.fetchImplementation(`${repositoryUrl}/git/trees`, {
      method: "POST", headers: { ...this.headers(token), "content-type": "application/json" },
      body: JSON.stringify({ base_tree: baseSha, tree: blobs.map(({ path, sha }) => ({ path, mode: "100644", type: "blob", sha })) }),
    });
    if (!treeResponse.ok) throw new GithubApiError(treeResponse.status, "create setup tree", await safeGithubErrorDetail(treeResponse));
    const treePayload = (await treeResponse.json().catch(() => null)) as { sha?: unknown } | null;
    if (typeof treePayload?.sha !== "string") throw new Error("GitHub tree response is invalid.");

    const commitResponse = await this.fetchImplementation(`${repositoryUrl}/git/commits`, {
      method: "POST", headers: { ...this.headers(token), "content-type": "application/json" },
      body: JSON.stringify({ message: input.title, tree: treePayload.sha, parents: [baseSha] }),
    });
    if (!commitResponse.ok) throw new GithubApiError(commitResponse.status, "create setup commit", await safeGithubErrorDetail(commitResponse));
    const commitPayload = (await commitResponse.json().catch(() => null)) as { sha?: unknown } | null;
    if (typeof commitPayload?.sha !== "string") throw new Error("GitHub commit response is invalid.");
    const branch = `ade/setup/${Date.now().toString(36)}`;
    const refCreateResponse = await this.fetchImplementation(`${repositoryUrl}/git/refs`, {
      method: "POST", headers: { ...this.headers(token), "content-type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitPayload.sha }),
    });
    if (!refCreateResponse.ok) throw new GithubApiError(refCreateResponse.status, "create setup branch", await safeGithubErrorDetail(refCreateResponse));
    return this.createPullRequest(repository, { title: input.title, body: input.body, head: branch, base });
  }

  public async findOpenSetupPullRequest(repository: GithubRepositoryRef, title: string): Promise<GithubPullRequest | null> {
    const token = await this.options.tokens.getToken(this.options.installationId);
    const response = await this.fetchImplementation(
      `${this.baseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?state=open&per_page=100`,
      { headers: this.headers(token) },
    );
    if (!response.ok) throw new GithubApiError(response.status, "find setup pull request", await safeGithubErrorDetail(response));
    const parsed: unknown = await response.json().catch(() => null);
    if (!Array.isArray(parsed)) throw new Error("GitHub pull request list response is invalid.");
    for (const value of parsed) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const candidate = value as { title?: unknown; number?: unknown; html_url?: unknown; head?: { ref?: unknown }; base?: { ref?: unknown } };
      if (candidate.title === title && Number.isInteger(candidate.number) && typeof candidate.html_url === "string" && typeof candidate.head?.ref === "string" && typeof candidate.base?.ref === "string") {
        return { number: Number(candidate.number), url: candidate.html_url, head: candidate.head.ref, base: candidate.base.ref };
      }
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

function normalizeIssueDetails(value: unknown, repository: GithubRepositoryRef): GithubIssueDetails | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const issue = value as { number?: unknown; title?: unknown; body?: unknown; labels?: unknown; state?: unknown; html_url?: unknown; updated_at?: unknown; pull_request?: unknown };
  if (issue.pull_request !== undefined || !Number.isInteger(issue.number) || typeof issue.title !== "string" || typeof issue.body !== "string" || (issue.state !== "open" && issue.state !== "closed") || typeof issue.html_url !== "string" || typeof issue.updated_at !== "string" || !Array.isArray(issue.labels)) return null;
  const labels = issue.labels.flatMap((label) => typeof label === "object" && label !== null && !Array.isArray(label) && typeof (label as { name?: unknown }).name === "string" ? [(label as { name: string }).name] : []);
  if (labels.length !== issue.labels.length || new TextEncoder().encode(issue.body).byteLength > 32 * 1024) return null;
  const expectedPrefix = `https://github.com/${repository.owner}/${repository.name}/issues/`;
  if (!issue.html_url.startsWith(expectedPrefix) || Number.isNaN(Date.parse(issue.updated_at))) return null;
  return { number: Number(issue.number), title: issue.title.slice(0, 500), body: issue.body, labels, state: issue.state, url: issue.html_url, updatedAt: new Date(issue.updated_at).toISOString() };
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
  implements GithubClient, GithubPullRequestClient, GithubSetupClient, GithubIssueLifecycleClient
{
  public readonly created: { issueNumber: number; body: string }[] = [];
  public readonly updated: { commentId: string; body: string }[] = [];
  public readonly createdPullRequests: {
    repository: GithubRepositoryRef;
    input: GithubPullRequestInput;
  }[] = [];

  private nextId = 1;

  public readonly contents = new Map<string, GithubRepositoryContent>();
  public readonly labels: GithubLabel[] = [];
  public repositoryMetadata: GithubRepositoryMetadata = { id: "123", owner: "dokor", name: "alpha", defaultBranch: "main", private: false, url: "https://github.com/dokor/alpha" };
  private readonly setupPullRequests = new Map<string, GithubPullRequest>();
  public readonly issues = new Map<number, GithubIssueDetails>();

  public async getIssueDetails(_repository: GithubRepositoryRef, issueNumber: number): Promise<GithubIssueDetails | null> {
    return this.issues.get(issueNumber) ?? null;
  }

  public async updateIssueBody(_repository: GithubRepositoryRef, issueNumber: number, body: string): Promise<GithubIssueDetails> {
    const issue = this.issues.get(issueNumber);
    if (!issue) throw new Error("GitHub issue was not found.");
    const updated = { ...issue, body, updatedAt: new Date().toISOString() };
    this.issues.set(issueNumber, updated);
    return updated;
  }

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

  public async getRepositoryContent(_repository: GithubRepositoryRef, path: string): Promise<GithubRepositoryContent | null> {
    return this.contents.get(path) ?? null;
  }

  public async getRepositoryMetadata(_repository: GithubRepositoryRef): Promise<GithubRepositoryMetadata> {
    return this.repositoryMetadata;
  }

  public async listLabels(_repository: GithubRepositoryRef): Promise<readonly GithubLabel[]> {
    return [...this.labels];
  }

  public async createLabel(_repository: GithubRepositoryRef, label: GithubLabel): Promise<GithubLabel> {
    this.labels.push(label);
    return label;
  }

  public async createSetupPullRequest(repository: GithubRepositoryRef, input: GithubSetupPullRequestInput): Promise<GithubPullRequest> {
    const pullRequest = await this.createPullRequest(repository, { title: input.title, body: input.body, head: "ade/setup/fake", base: input.baseBranch ?? "main" });
    this.setupPullRequests.set(input.title, pullRequest);
    return pullRequest;
  }

  public async findOpenSetupPullRequest(_repository: GithubRepositoryRef, title: string): Promise<GithubPullRequest | null> {
    return this.setupPullRequests.get(title) ?? null;
  }
}
