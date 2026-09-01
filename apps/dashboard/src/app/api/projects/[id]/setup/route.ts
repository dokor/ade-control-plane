import { NextResponse } from "next/server";

import { ControlError } from "../../../../../lib/errors.js";
import { handleDashboardApi, readJsonObject } from "../../../../../lib/dashboardApi.js";
import { loadGithubRuntime } from "../../../../../lib/githubRuntime.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { inspectProjectSetup, prepareProjectSetup } from "../../../../../lib/projectSetup.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "read", async () => {
    const { id } = await params;
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(id);
    if (!project) throw new ControlError("NOT_FOUND", "Project was not found.");
    return { body: { readiness: await inspectProjectSetup(project, await loadGithubRuntime()) } };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ correlationId, identity }) => {
    if (!identity) throw new ControlError("UNAUTHENTICATED", "Authentication is required.");
    const body = await readJsonObject(request);
    if (body.action !== "prepare") throw new ControlError("INVALID_COMMAND", "Setup action must be prepare.");
    const { id } = await params;
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(id);
    if (!project) throw new ControlError("NOT_FOUND", "Project was not found.");
    const result = await prepareProjectSetup(project, await loadGithubRuntime());
    await persistence.auditEvents.append({
      occurredAt: new Date().toISOString(),
      category: "project-setup",
      severity: "info",
      actorType: "dashboard",
      actorRef: identity.actorRef,
      projectId: project.id,
      action: "project.setup.prepare",
      result: "applied",
      correlationId,
      metadata: {
        labelsCreated: result.labelsCreated.length,
        pullRequestNumber: result.pullRequestNumber,
        pullRequestUrl: result.pullRequestUrl,
      },
    });
    return { body: { result } };
  });
}
