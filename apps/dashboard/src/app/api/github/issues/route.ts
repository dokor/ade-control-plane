import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { httpStatusForCode } from "../../../../lib/errors.js";
import { listReadyGithubIssues } from "../../../../lib/githubIssues.js";
import { loadGithubRuntime } from "../../../../lib/githubRuntime.js";
import { getPersistence } from "../../../../lib/persistence.js";
import { sanitizeError } from "../../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../../lib/taskRequest.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, false);
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    if (!UUID.test(projectId)) {
      return NextResponse.json(
        { code: "NOT_FOUND", summary: "The selected project is not available.", correlationId },
        { status: 404 },
      );
    }
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(projectId);
    if (!project || project.state !== "enabled") {
      return NextResponse.json(
        { code: "NOT_FOUND", summary: "The selected project is not available.", correlationId },
        { status: 404 },
      );
    }
    const github = await loadGithubRuntime();
    if (!github) {
      return NextResponse.json(
        { code: "UNAVAILABLE", summary: "GitHub issue selection is not configured.", correlationId },
        { status: 503 },
      );
    }
    const issues = await listReadyGithubIssues(project, github);
    return NextResponse.json({ issues, correlationId });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
