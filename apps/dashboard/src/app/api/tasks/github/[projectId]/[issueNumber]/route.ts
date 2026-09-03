import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../../../lib/dashboardApi.js";
import { buildGithubWorkDetail, safePullRequestUrl, type GithubWorkDetailModel } from "../../../../../../lib/taskReadModel.js";
import { getPersistence } from "../../../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Machine-readable, browser-safe projection used by production qualification
 * and operational tooling. It deliberately excludes the raw project config,
 * issue body, prompts, source and unrestricted execution output.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; issueNumber: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "read", async () => {
    const { projectId, issueNumber: rawIssueNumber } = await context.params;
    const issueNumber = Number(rawIssueNumber);
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
      return { body: { detail: null }, status: 404 };
    }
    const detail = await buildGithubWorkDetail(await getPersistence(), projectId, issueNumber);
    if (!detail) return { body: { detail: null }, status: 404 };
    return { body: { detail: toGithubWorkApiView(detail) } };
  });
}

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
