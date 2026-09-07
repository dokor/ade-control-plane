import type { ProjectRecord } from "@ade-control-plane/database";
import { DEFAULT_GITHUB_WORK_METADATA, labelsForGithubWorkState, readGithubWorkMetadata, upsertGithubWorkMetadata, type GithubIssueLifecycleClient } from "@ade-control-plane/github";
import { githubWorkStage } from "./taskReadModel.js";
import { ControlError } from "./errors.js";

export async function admitGithubIssue(project: ProjectRecord, client: GithubIssueLifecycleClient, issueNumber: number, resetRemoved = false) {
  const repository = { id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`, owner: project.repositoryOwner, name: project.repositoryName };
  const issue = await client.getIssueDetails(repository, issueNumber);
  if (!issue || issue.state !== "open") throw new ControlError("NOT_FOUND", "The selected GitHub issue is no longer open or accessible.");
  const previous = readGithubWorkMetadata(issue.body);
  const metadata = resetRemoved ? { ...DEFAULT_GITHUB_WORK_METADATA, priority: previous?.priority ?? 50, dependsOn: previous?.dependsOn ?? [] }
    : previous ?? DEFAULT_GITHUB_WORK_METADATA;
  if (resetRemoved || !previous) await client.updateIssueBody(repository, issue.number, upsertGithubWorkMetadata(issue.body, metadata));
  await client.syncAdeWorkflowLabels(repository, issue.number, labelsForGithubWorkState(metadata.state, metadata.pullRequestNumber));
  return { issueNumber: issue.number, stage: metadata.state === "ready" ? "Queued for ADE" : githubWorkStage(metadata.state, null) };
}
