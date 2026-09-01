import { NextResponse } from "next/server";

import { ControlError } from "../../../../lib/errors.js";
import { handleDashboardApi } from "../../../../lib/dashboardApi.js";
import { listGithubIssues } from "../../../../lib/githubIssues.js";
import { loadGithubRuntime } from "../../../../lib/githubRuntime.js";
import { getPersistence } from "../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<NextResponse> {
  return handleDashboardApi(request, "read", async () => {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    if (!UUID.test(projectId)) {
      throw new ControlError("NOT_FOUND", "The selected project is not available.");
    }
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(projectId);
    if (!project || project.state !== "enabled") {
      throw new ControlError("NOT_FOUND", "The selected project is not available.");
    }
    const github = await loadGithubRuntime();
    if (!github) {
      throw new ControlError("UNAVAILABLE", "GitHub issue selection is not configured.");
    }
    const issues = await listGithubIssues(project, github);
    return { body: { issues } };
  });
}
