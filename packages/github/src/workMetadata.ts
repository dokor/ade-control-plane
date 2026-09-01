import { GITHUB_WORK_ITEM_VERSION, type GithubWorkRetryPolicy, type GithubWorkState } from "./workAdapter.js";

export interface GithubWorkMetadata {
  state: GithubWorkState;
  priority: number;
  dependsOn: number[];
  retryPolicy: GithubWorkRetryPolicy;
  humanDecisionRef: string | null;
  executionRef: string | null;
  branchName: string | null;
  pullRequestNumber: number | null;
}

export const DEFAULT_GITHUB_WORK_METADATA: GithubWorkMetadata = {
  state: "ready", priority: 50, dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null,
  executionRef: null, branchName: null, pullRequestNumber: null,
};

/** Replaces exactly one lifecycle marker or appends a new one. */
export function upsertGithubWorkMetadata(body: string, metadata: GithubWorkMetadata): string {
  const marker = `<!-- ${GITHUB_WORK_ITEM_VERSION} ${JSON.stringify(metadata)} -->`;
  const expression = /<!-- ade\.github-work\/v1\s+\{[^]*?\}\s*-->/gu;
  const matches = [...body.matchAll(expression)];
  if (matches.length > 1) throw new Error("GitHub issue contains duplicate ADE work metadata.");
  if (matches.length === 1) return body.replace(expression, marker);
  return `${body.trimEnd()}${body.trim() ? "\n\n" : ""}${marker}\n`;
}

export function readGithubWorkMetadata(body: string): GithubWorkMetadata | null {
  const match = body.match(/<!-- ade\.github-work\/v1\s+(\{[^]*?\})\s*-->/u);
  if (!match?.[1]) return null;
  try {
    const value: unknown = JSON.parse(match[1]);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const metadata = value as Partial<GithubWorkMetadata>;
    return typeof metadata.state === "string" && typeof metadata.priority === "number" && Array.isArray(metadata.dependsOn) && typeof metadata.retryPolicy === "string" && "humanDecisionRef" in metadata && "executionRef" in metadata && "branchName" in metadata && "pullRequestNumber" in metadata
      ? metadata as GithubWorkMetadata : null;
  } catch { return null; }
}
