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
  adeState: "ready";
  priority: number;
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

  const repository = {
    id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`,
    owner: project.repositoryOwner,
    name: project.repositoryName,
  };
  const [issues, workItems] = await Promise.all([
    readers.issueReader.listIssues(repository),
    readers.workReader.listWorkItems(repository),
  ]);
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));

  return workItems
    .filter((item) => item.state === "ready")
    .flatMap((item) => {
      const issue = issueByNumber.get(item.issueNumber);
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
