import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { ControlError, httpStatusForCode } from "../../../../../lib/errors.js";
import { loadGithubRuntime } from "../../../../../lib/githubRuntime.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { inspectProjectSetup, prepareProjectSetup } from "../../../../../lib/projectSetup.js";
import { sanitizeError } from "../../../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../../../lib/taskRequest.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, false);
    const { id } = await params;
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(id);
    if (!project) throw new ControlError("NOT_FOUND", "Project was not found.");
    return NextResponse.json({ readiness: await inspectProjectSetup(project, await loadGithubRuntime()) });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    const identity = await authorizeTaskRequest(request, true);
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
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
    return NextResponse.json({ result, correlationId });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
