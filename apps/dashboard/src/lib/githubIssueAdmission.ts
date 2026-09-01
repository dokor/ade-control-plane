import type { ProjectRecord } from "@ade-control-plane/database";
import { DEFAULT_GITHUB_WORK_METADATA, readGithubWorkMetadata, upsertGithubWorkMetadata, type GithubIssueLifecycleClient } from "@ade-control-plane/github";
import { ControlError } from "./errors.js";

export async function admitGithubIssue(project: ProjectRecord, client: GithubIssueLifecycleClient, issueNumber: number) {
  const repository = { id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`, owner: project.repositoryOwner, name: project.repositoryName };
  const issue = await client.getIssueDetails(repository, issueNumber);
  if (!issue || issue.state !== "open") throw new ControlError("NOT_FOUND", "The selected GitHub issue is no longer open or accessible.");
  const metadata = readGithubWorkMetadata(issue.body) ?? DEFAULT_GITHUB_WORK_METADATA;
  if (!readGithubWorkMetadata(issue.body)) await client.updateIssueBody(repository, issue.number, upsertGithubWorkMetadata(issue.body, metadata));
  return { issueNumber: issue.number, stage: metadata.state === "waiting-human" ? "Waiting for human" : metadata.state === "completed" ? "Completed" : metadata.state === "running" ? "Developing" : "Preparing issue" };
}
