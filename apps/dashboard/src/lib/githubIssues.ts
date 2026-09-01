import type { ProjectRecord } from "@ade-control-plane/database";
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
      }];
    })
    .sort((left, right) => right.priority - left.priority || left.number - right.number);
}

function repositoryRef(project: ProjectRecord) {
  return {
    id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`,
    owner: project.repositoryOwner,
    name: project.repositoryName,
  };
}
