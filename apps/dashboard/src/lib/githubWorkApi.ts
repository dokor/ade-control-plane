import { safePullRequestUrl, type GithubWorkDetailModel } from "./taskReadModel.js";

/**
 * Machine-readable, browser-safe projection used by production qualification
 * and operational tooling. It deliberately excludes the raw project config,
 * issue body, prompts, source and unrestricted execution output.
 */
export function toGithubWorkApiView(detail: GithubWorkDetailModel) {
  const { project, work, workflow, execution } = detail;
  return {
    project: {
      id: project.id,
      name: project.name,
      repositoryOwner: project.repositoryOwner,
      repositoryName: project.repositoryName,
    },
    issue: {
      number: work.issueNumber,
      url: work.issueUrl,
      sourceUpdatedAt: work.sourceUpdatedAt,
    },
    state: work.state,
    stage: workflow?.stage ?? work.state,
    stageLabel: detail.stageLabel,
    nextAction: detail.nextAction,
    execution: execution
      ? {
          id: execution.id,
          status: execution.status,
          attempt: execution.attempt,
          errorCode: execution.errorCode,
          errorSummary: execution.errorSummary,
          cancelRequested: execution.cancelRequested,
        }
      : null,
    workflow: workflow
      ? {
          id: workflow.id,
          stage: workflow.stage,
          branchName: workflow.branchName,
          headSha: workflow.headSha,
          pullRequestNumber: workflow.pullRequestNumber,
          pullRequestUrl: safePullRequestUrl(workflow.pullRequestUrl),
          reconciliationRequired: workflow.reconciliationRequired,
        }
      : null,
    heartbeatAt: detail.heartbeatAt,
    deadlineAt: detail.deadlineAt,
    decision: detail.decision,
    provenance: detail.provenance,
    validationSummary: detail.validationSummary,
    reviewSummary: detail.reviewSummary,
    transitions: detail.transitions,
    events: detail.events,
    firstFailure: detail.firstFailure,
  };
}
