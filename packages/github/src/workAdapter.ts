import { Buffer } from "node:buffer";

import type { GithubRepositoryRef } from "./domain.js";
import type { InstallationTokenProvider } from "./client.js";

export const GITHUB_WORK_PROFILE_VERSION = "ade.github-work-profile/v1";
export const GITHUB_WORK_ITEM_VERSION = "ade.github-work/v1";
export const GITHUB_WORK_PROFILE_PATH = ".ade/control-plane.json";

const MAX_PROFILE_BYTES = 32 * 1024;
const MAX_ISSUE_BODY_BYTES = 32 * 1024;
const MAX_RECONCILIATION_PAGES = 10;
const DEFAULT_FRESHNESS_MS = 5 * 60 * 1_000;

export type GithubWorkState =
  | "ready"
  | "running"
  | "waiting-human"
  | "blocked"
  | "completed"
  | "failed";

export type GithubWorkRetryPolicy = "safe" | "reconcile-first" | "never";

export interface GithubWorkRepositoryProfile {
  repository: GithubRepositoryRef;
  compatible: boolean;
  contractVersion: typeof GITHUB_WORK_PROFILE_VERSION | null;
  capabilities: readonly string[];
  skillPaths: readonly string[];
  observedAt: string;
  reason: "compatible" | "missing-profile" | "invalid-profile" | "unsupported-profile" | "reconciliation-deferred";
}

/**
 * A safe, scheduler-ready representation. No issue title/body/comment text is
 * retained or used to infer state, order or dependencies.
 */
export interface GithubWorkItem {
  contractVersion: typeof GITHUB_WORK_ITEM_VERSION;
  repository: GithubRepositoryRef;
  issueNumber: number;
  issueUrl: string;
  state: GithubWorkState;
  priority: number;
  dependsOn: readonly number[];
  retryPolicy: GithubWorkRetryPolicy;
  humanDecisionRef: string | null;
  executionRef: string | null;
  branchName: string | null;
  pullRequestNumber: number | null;
  sourceUpdatedAt: string;
  observedAt: string;
  expiresAt: string;
}

export interface GithubWorkReader {
  detectRepository(repository: GithubRepositoryRef): Promise<GithubWorkRepositoryProfile>;
  getWorkItem(repository: GithubRepositoryRef, issueNumber: number): Promise<GithubWorkItem | null>;
  listWorkItems(repository: GithubRepositoryRef): Promise<readonly GithubWorkItem[]>;
}

export interface HttpGithubWorkAdapterOptions {
  tokens: InstallationTokenProvider;
  installationId: string;
  baseUrl?: string;
  userAgent?: string;
  fetchImplementation?: typeof fetch;
  now?(): Date;
  freshnessMs?: number;
  maxPages?: number;
}

/** GitHub App REST reader for the versioned GitHub-first work contract. */
export class HttpGithubWorkAdapter implements GithubWorkReader {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private readonly freshnessMs: number;
  private readonly maxPages: number;

  public constructor(private readonly options: HttpGithubWorkAdapterOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    this.userAgent = options.userAgent ?? "ade-control-plane";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.freshnessMs = positiveInteger(options.freshnessMs, DEFAULT_FRESHNESS_MS);
    this.maxPages = positiveInteger(options.maxPages, MAX_RECONCILIATION_PAGES);
  }

  public async detectRepository(repository: GithubRepositoryRef): Promise<GithubWorkRepositoryProfile> {
    const observedAt = this.now().toISOString();
    const response = await this.request(
      `/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${GITHUB_WORK_PROFILE_PATH}`,
    );
    if (response.status === 404) return incompatible(repository, observedAt, "missing-profile");
    if (!response.ok) throw githubWorkAdapterError(response, "read repository profile", this.now());

    const content = await safeJson(response);
    const profile = parseRepositoryProfile(content);
    if (!profile) return incompatible(repository, observedAt, "invalid-profile");
    if (!profile.capabilities.includes("github-work-items")) {
      return incompatible(repository, observedAt, "unsupported-profile");
    }
    return {
      repository,
      compatible: true,
      contractVersion: GITHUB_WORK_PROFILE_VERSION,
      capabilities: profile.capabilities,
      skillPaths: profile.skillPaths,
      observedAt,
      reason: "compatible",
    };
  }

  public async getWorkItem(
    repository: GithubRepositoryRef,
    issueNumber: number,
  ): Promise<GithubWorkItem | null> {
    if (!validIssueNumber(issueNumber)) return null;
    const profile = await this.detectRepository(repository);
    if (!profile.compatible) return null;
    const response = await this.request(
      `/repos/${encode(repository.owner)}/${encode(repository.name)}/issues/${issueNumber}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw githubWorkAdapterError(response, "read issue", this.now());
    return normalizeGithubWorkItem(await safeJson(response), profile, this.now(), this.freshnessMs);
  }

  public async listWorkItems(repository: GithubRepositoryRef): Promise<readonly GithubWorkItem[]> {
    const profile = await this.detectRepository(repository);
    if (!profile.compatible) return [];

    const observedAt = this.now();
    const workItems = new Map<number, GithubWorkItem>();
    for (let page = 1; page <= this.maxPages; page += 1) {
      const response = await this.request(
        `/repos/${encode(repository.owner)}/${encode(repository.name)}/issues?state=all&per_page=100&sort=updated&direction=desc&page=${page}`,
      );
      if (!response.ok) throw githubWorkAdapterError(response, "list issues", this.now());
      const issues = await safeJson(response);
      if (!Array.isArray(issues)) throw new GithubWorkAdapterError(502, "validate issue list");
      for (const issue of issues) {
        const workItem = normalizeGithubWorkItem(issue, profile, observedAt, this.freshnessMs);
        if (workItem) workItems.set(workItem.issueNumber, workItem);
      }
      if (issues.length < 100) break;
    }
    return [...workItems.values()].toSorted((left, right) =>
      right.priority - left.priority || left.issueNumber - right.issueNumber,
    );
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

/**
 * Shared strict normalization used for both periodic reconciliation and a
 * validated GitHub webhook that needs to refresh one issue.
 */
export function normalizeGithubWorkItem(
  issue: unknown,
  profile: GithubWorkRepositoryProfile,
  observedAt: Date,
  freshnessMs = DEFAULT_FRESHNESS_MS,
): GithubWorkItem | null {
  if (!profile.compatible || !isRecord(issue) || "pull_request" in issue) return null;
  const number = issue.number;
  const body = issue.body;
  const url = issue.html_url;
  const sourceUpdatedAt = issue.updated_at;
  if (!validIssueNumber(number) || typeof body !== "string" ||
      Buffer.byteLength(body, "utf8") > MAX_ISSUE_BODY_BYTES ||
      typeof url !== "string" || !isSafeHttpsUrl(url) ||
      typeof sourceUpdatedAt !== "string" || Number.isNaN(Date.parse(sourceUpdatedAt))) {
    return null;
  }
  const metadata = parseWorkMetadata(body, number);
  if (!metadata) return null;
  const observedAtIso = observedAt.toISOString();
  const safeFreshnessMs = positiveInteger(freshnessMs, DEFAULT_FRESHNESS_MS);
  return {
    contractVersion: GITHUB_WORK_ITEM_VERSION,
    repository: profile.repository,
    issueNumber: number,
    issueUrl: url,
    state: metadata.state,
    priority: metadata.priority,
    dependsOn: metadata.dependsOn,
    retryPolicy: metadata.retryPolicy,
    humanDecisionRef: metadata.humanDecisionRef,
    executionRef: metadata.executionRef,
    branchName: metadata.branchName,
    pullRequestNumber: metadata.pullRequestNumber,
    sourceUpdatedAt,
    observedAt: observedAtIso,
    expiresAt: new Date(observedAt.getTime() + safeFreshnessMs).toISOString(),
  };
}

/** Freshness is explicit so callers never silently schedule a stale GitHub read. */
export function isGithubWorkItemFresh(item: GithubWorkItem, asOf: string): boolean {
  const expiresAt = Date.parse(item.expiresAt);
  const now = Date.parse(asOf);
  return !Number.isNaN(expiresAt) && !Number.isNaN(now) && expiresAt > now;
}

export class GithubWorkAdapterError extends Error {
  public constructor(public readonly status: number, action: string, public readonly retryAt?: string) {
    super(`GitHub work adapter ${action} failed with status ${status}.`);
    this.name = "GithubWorkAdapterError";
  }
}

function githubWorkAdapterError(response: Response, action: string, now: Date): GithubWorkAdapterError {
  return new GithubWorkAdapterError(response.status, action, retryAtFromHeaders(response.headers, now));
}

function retryAtFromHeaders(headers: Headers, now: Date): string | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter && /^\d+$/u.test(retryAfter)) {
    return new Date(now.getTime() + Number(retryAfter) * 1_000).toISOString();
  }
  const rateLimitReset = headers.get("x-ratelimit-reset");
  if (rateLimitReset && /^\d+$/u.test(rateLimitReset)) {
    const reset = Number(rateLimitReset) * 1_000;
    if (Number.isSafeInteger(reset) && reset > now.getTime()) return new Date(reset).toISOString();
  }
  return undefined;
}

interface RepositoryProfileData {
  capabilities: readonly string[];
  skillPaths: readonly string[];
}

interface WorkMetadata {
  state: GithubWorkState;
  priority: number;
  dependsOn: readonly number[];
  retryPolicy: GithubWorkRetryPolicy;
  humanDecisionRef: string | null;
  executionRef: string | null;
  branchName: string | null;
  pullRequestNumber: number | null;
}

function incompatible(
  repository: GithubRepositoryRef,
  observedAt: string,
  reason: Exclude<GithubWorkRepositoryProfile["reason"], "compatible">,
): GithubWorkRepositoryProfile {
  return {
    repository,
    compatible: false,
    contractVersion: null,
    capabilities: [],
    skillPaths: [],
    observedAt,
    reason,
  };
}

function parseRepositoryProfile(value: unknown): RepositoryProfileData | null {
  if (!isRecord(value) || value.type !== "file" || value.encoding !== "base64" ||
      typeof value.content !== "string") return null;
  let parsed: unknown;
  try {
    const content = Buffer.from(value.content.replace(/\s/g, ""), "base64");
    if (content.length > MAX_PROFILE_BYTES) return null;
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !exactKeys(parsed, ["version", "capabilities", "skillPaths"]) ||
      parsed.version !== GITHUB_WORK_PROFILE_VERSION || !isStringArray(parsed.capabilities) ||
      !isSafeSkillPaths(parsed.skillPaths)) return null;
  return { capabilities: [...new Set(parsed.capabilities)].toSorted(), skillPaths: parsed.skillPaths };
}

function parseWorkMetadata(body: string, issueNumber: number): WorkMetadata | null {
  const marker = `<!-- ${GITHUB_WORK_ITEM_VERSION} `;
  const start = body.indexOf(marker);
  if (start < 0 || body.indexOf(marker, start + marker.length) >= 0) return null;
  const end = body.indexOf("-->", start + marker.length);
  if (end < 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start + marker.length, end).trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !exactKeys(parsed, [
    "state", "priority", "dependsOn", "retryPolicy", "humanDecisionRef",
    "executionRef", "branchName", "pullRequestNumber",
  ])) return null;
  if (!isGithubWorkState(parsed.state) || !validPriority(parsed.priority) ||
      !isDependencyList(parsed.dependsOn, issueNumber) || !isRetryPolicy(parsed.retryPolicy) ||
      !nullableOpaqueRef(parsed.humanDecisionRef) || !nullableOpaqueRef(parsed.executionRef) ||
      !nullableBranchName(parsed.branchName) || !nullableIssueNumber(parsed.pullRequestNumber)) return null;
  return {
    state: parsed.state,
    priority: parsed.priority,
    dependsOn: parsed.dependsOn,
    retryPolicy: parsed.retryPolicy,
    humanDecisionRef: parsed.humanDecisionRef,
    executionRef: parsed.executionRef,
    branchName: parsed.branchName,
    pullRequestNumber: parsed.pullRequestNumber,
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GithubWorkAdapterError(502, "parse response");
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).toSorted();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].toSorted()[index]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every((item) =>
    typeof item === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(item),
  );
}

function isSafeSkillPaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 16 && value.every((path) =>
    typeof path === "string" && /^\.\/?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path) &&
      !path.split("/").includes(".."),
  );
}

function isDependencyList(value: unknown, issueNumber: number): value is number[] {
  return Array.isArray(value) && value.length <= 64 &&
    value.every((dependency) => validIssueNumber(dependency) && dependency !== issueNumber) &&
    new Set(value).size === value.length;
}

function nullableOpaqueRef(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value));
}

function nullableBranchName(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(value) &&
    !value.includes("..") && !value.endsWith("/"));
}

function nullableIssueNumber(value: unknown): value is number | null {
  return value === null || validIssueNumber(value);
}

function validIssueNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validPriority(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

function isGithubWorkState(value: unknown): value is GithubWorkState {
  return typeof value === "string" && ["ready", "running", "waiting-human", "blocked", "completed", "failed"].includes(value);
}

function isRetryPolicy(value: unknown): value is GithubWorkRetryPolicy {
  return value === "safe" || value === "reconcile-first" || value === "never";
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encode(value: string): string {
  return encodeURIComponent(value);
}
