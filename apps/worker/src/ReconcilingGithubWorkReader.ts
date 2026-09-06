import type { ControlPlanePersistence } from "@ade-control-plane/database";
import {
  DEFAULT_GITHUB_WORK_METADATA,
  labelsForGithubWorkState,
  readGithubWorkMetadata,
  upsertGithubWorkMetadata,
  type GithubIssueLifecycleClient,
  type GithubRepositoryRef,
  type GithubWorkItem,
  type GithubWorkReader,
  type GithubWorkRepositoryProfile,
} from "@ade-control-plane/github";

import type { GithubPullRequestStatusReader } from "./GithubPullRequestStatusReader.js";

export interface ReconcilingGithubWorkReaderOptions {
  reader: GithubWorkReader;
  pullRequests: GithubPullRequestStatusReader;
  lifecycle: GithubIssueLifecycleClient;
  persistence: Pick<ControlPlanePersistence, "deliveryWorkflows">;
  now?(): Date;
}

/**
 * Decorates the read-only GitHub work adapter with one bounded repair step:
 * terminal PR state is reconciled back into ADE metadata before the scheduler
 * persists its projection. This is the missed-webhook recovery path.
 */
export class ReconcilingGithubWorkReader implements GithubWorkReader {
  private readonly now: () => Date;

  public constructor(private readonly options: ReconcilingGithubWorkReaderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public detectRepository(repository: GithubRepositoryRef): Promise<GithubWorkRepositoryProfile> {
    return this.options.reader.detectRepository(repository);
  }

  public async getWorkItem(repository: GithubRepositoryRef, issueNumber: number): Promise<GithubWorkItem | null> {
    const item = await this.options.reader.getWorkItem(repository, issueNumber);
    if (!item) return null;
    const changed = await this.reconcileItem(repository, item);
    return changed ? this.options.reader.getWorkItem(repository, issueNumber) : item;
  }

  public async listWorkItems(repository: GithubRepositoryRef): Promise<readonly GithubWorkItem[]> {
    const items = await this.options.reader.listWorkItems(repository);
    let changed = false;
    for (const item of items) changed = await this.reconcileItem(repository, item) || changed;
    return changed ? this.options.reader.listWorkItems(repository) : items;
  }

  private async reconcileItem(repository: GithubRepositoryRef, item: GithubWorkItem): Promise<boolean> {
    const { pullRequestNumber, branchName, executionRef } = item;
    if (!pullRequestNumber || !branchName || !executionRef) return false;
    if (item.state !== "waiting-human" && item.state !== "blocked" && item.state !== "completed") return false;

    const workflow = await this.options.persistence.deliveryWorkflows?.getByExecutionId(executionRef);
    if (item.state === "completed" && (!workflow || workflow.stage === "completed")) return false;

    const pullRequest = await this.options.pullRequests.get(repository, pullRequestNumber);
    if (!pullRequest || pullRequest.state !== "closed" || !pullRequest.merged || pullRequest.headRef !== branchName) return false;

    const issue = await this.options.lifecycle.getIssueDetails(repository, item.issueNumber);
    const metadata = issue ? readGithubWorkMetadata(issue.body) : null;
    if (!issue || !metadata) return false;
    const correlated = metadata.pullRequestNumber === pullRequestNumber &&
      metadata.branchName === branchName && metadata.executionRef === executionRef;
    if (!correlated) return false;

    let githubChanged = false;
    if (metadata.state !== "completed" || metadata.humanDecisionRef !== null) {
      const nextMetadata = {
        ...(readGithubWorkMetadata(issue.body) ?? DEFAULT_GITHUB_WORK_METADATA),
        state: "completed" as const,
        humanDecisionRef: null,
      };
      await this.options.lifecycle.updateIssueBody(
        repository,
        item.issueNumber,
        upsertGithubWorkMetadata(issue.body, nextMetadata),
      );
      githubChanged = true;
    }
    await this.options.lifecycle.syncAdeWorkflowLabels(
      repository,
      item.issueNumber,
      labelsForGithubWorkState("completed", pullRequestNumber),
    );

    if (workflow && workflow.stage === "waiting-human" &&
        workflow.pullRequestNumber === pullRequestNumber && workflow.branchName === branchName) {
      await this.options.persistence.deliveryWorkflows?.transition({
        workflowId: workflow.id,
        expectedStage: "waiting-human",
        stage: "completed",
        attempt: workflow.attempt,
        reason: "GitHub reconciliation confirmed the correlated ADE pull request was merged.",
        idempotencyKey: `${workflow.id}:merged-pr:${pullRequestNumber}:completed`,
        occurredAt: this.now().toISOString(),
        branchName,
        pullRequestNumber,
        pullRequestUrl: workflow.pullRequestUrl,
        humanDecisionRef: null,
      });
      return true;
    }

    return githubChanged;
  }
}
