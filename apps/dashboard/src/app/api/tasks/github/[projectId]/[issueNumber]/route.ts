import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../../../lib/dashboardApi.js";
import { toGithubWorkApiView } from "../../../../../../lib/githubWorkApi.js";
import { buildGithubWorkDetail } from "../../../../../../lib/taskReadModel.js";
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
