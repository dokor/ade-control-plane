import type { GithubIssueQueuePreferenceRecord, GithubWorkItemRecord, ProjectRecord } from "@ade-control-plane/database";
import type {
  GithubIssueReader,
  GithubWorkReader,
} from "@ade-control-plane/github";

import { ControlError } from "./errors.js";
import { sanitizeText } from "./sanitize.js";

export interface TaskGithubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  updatedAt: string;
  /** Present only when a separate ADE work projection marked the issue ready. */
  adeState: "ready" | null;
  priority: number | null;
  description?: string;
}

export interface ProjectGithubIssueQueueItem extends TaskGithubIssue {
  runWhenAvailable: boolean;
  queuePosition: number | null;
  workState: GithubWorkItemRecord["state"] | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  /** A stale ADE work projection is never made actionable from this view. */
  projectionState: "current" | "stale";
}

/**
 * Lists the repository's open GitHub issues for the Task picker.
 *
 * Discovery is deliberately independent from ADE compatibility. Execution
 * eligibility remains checked by listReadyGithubIssues at task creation time.
 */
export async function listGithubIssues(
  project: ProjectRecord,
  readers: { issueReader: GithubIssueReader | undefined },
): Promise<readonly TaskGithubIssue[]> {
  if (!readers.issueReader) {
    throw new ControlError("UNAVAILABLE", "GitHub issue selection is not configured.");
  }

  const repository = repositoryRef(project);
  const issues = await readers.issueReader.listIssues(repository);
  return issues
    .filter((issue) => issue.state === "open")
    .map((issue) => ({
      number: issue.number,
      title: sanitizeText(issue.title, 240),
      state: issue.state,
      url: issue.url,
      updatedAt: issue.updatedAt,
      adeState: null,
      priority: null,
      ...(issue.excerpt ? { description: sanitizeText(issue.excerpt, 360) } : {}),
    }))
    .sort((left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.number - right.number,
    );
}

export async function listReadyGithubIssues(
  project: ProjectRecord,
  readers: {
    issueReader: GithubIssueReader | undefined;
    workReader: GithubWorkReader | undefined;
  },
): Promise<readonly TaskGithubIssue[]> {
  if (!readers.issueReader || !readers.workReader) {
    throw new ControlError("UNAVAILABLE", "GitHub issue selection is not configured.");
  }

  const repository = repositoryRef(project);
  // Work metadata is the authoritative filter. Fetch display metadata only
  // for ready candidates so the Task page does not issue two full, concurrent
  // GitHub issue-list requests for the same repository.
  const workItems = await readers.workReader.listWorkItems(repository);
  const readyItems = workItems.filter((item) => item.state === "ready");
  const issues = await Promise.all(
    readyItems.map(async (item) => ({
      item,
      issue: await readers.issueReader!.getIssue(repository, item.issueNumber),
    })),
  );

  return issues
    .flatMap(({ item, issue }) => {
      if (!issue || issue.state !== "open") return [];
      return [{
        number: issue.number,
        title: sanitizeText(issue.title, 240),
        state: issue.state,
        url: issue.url,
        updatedAt: issue.updatedAt,
        adeState: "ready" as const,
        priority: item.priority,
        ...(issue.excerpt ? { description: sanitizeText(issue.excerpt, 360) } : {}),
      }];
    })
    .sort((left, right) => right.priority - left.priority || left.number - right.number);
}

/**
 * Joins live, bounded GitHub display metadata with the strict ADE work
 * projection and the independent operator-owned queue preference. Reconciliation
 * never writes the preference, and a stale projection remains visible but inert.
 */
export async function listProjectGithubIssueQueue(
  project: ProjectRecord,
  readers: { issueReader: GithubIssueReader | undefined },
  workItems: readonly GithubWorkItemRecord[],
  preferences: readonly GithubIssueQueuePreferenceRecord[],
  now = new Date().toISOString(),
): Promise<readonly ProjectGithubIssueQueueItem[]> {
  const issues = await listGithubIssues(project, readers);
  const workByIssue = new Map(workItems.filter(({ present }) => present).map((item) => [item.issueNumber, item]));
  const preferenceByIssue = new Map(preferences.map((preference) => [preference.issueNumber, preference]));
  const nowMs = Date.parse(now);
  const entries = issues.map((issue) => {
    const work = workByIssue.get(issue.number) ?? null;
    const preference = preferenceByIssue.get(issue.number) ?? null;
    const stale = work !== null && (!Number.isFinite(Date.parse(work.expiresAt)) || Date.parse(work.expiresAt) <= nowMs);
    const runWhenAvailable = preference?.runWhenAvailable ?? work?.state === "ready";
    const pullRequestNumber = work?.pullRequestNumber ?? null;
    return {
      ...issue,
      priority: work?.priority ?? issue.priority,
      ...(issue.description ? {} : { description: "No description provided." }),
      runWhenAvailable,
      queuePosition: preference?.queuePosition ?? null,
      workState: work?.state ?? null,
      pullRequestNumber,
      pullRequestUrl: pullRequestNumber === null ? null : pullRequestUrl(project, pullRequestNumber),
      projectionState: stale ? "stale" as const : "current" as const,
    };
  });
  return entries.toSorted((left, right) => {
    const leftRank = left.runWhenAvailable ? left.queuePosition ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const rightRank = right.runWhenAvailable ? right.queuePosition ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return Number(left.runWhenAvailable) === Number(right.runWhenAvailable)
      ? leftRank - rightRank || (right.priority ?? 0) - (left.priority ?? 0) || left.number - right.number
      : left.runWhenAvailable ? -1 : 1;
  });
}

function pullRequestUrl(project: ProjectRecord, pullRequestNumber: number): string {
  return `https://github.com/${encodeURIComponent(project.repositoryOwner)}/${encodeURIComponent(project.repositoryName)}/pull/${pullRequestNumber}`;
}

function repositoryRef(project: ProjectRecord) {
  return {
    id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`,
    owner: project.repositoryOwner,
    name: project.repositoryName,
  };
}
