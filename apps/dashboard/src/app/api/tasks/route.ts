import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { V0TaskSource } from "@ade-control-plane/database";

import { ControlError, httpStatusForCode } from "../../../lib/errors.js";
import { listReadyGithubIssues } from "../../../lib/githubIssues.js";
import { loadGithubRuntime } from "../../../lib/githubRuntime.js";
import { getPersistence } from "../../../lib/persistence.js";
import { sanitizeError } from "../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../lib/taskRequest.js";
import { createTask } from "../../../lib/tasks.js";
import { sanitizeTaskRecord } from "../../../lib/taskReadModel.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, false);
    const tasks = (await (await getPersistence()).v0Tasks.list(100)).map(sanitizeTaskRecord);
    return NextResponse.json({ tasks, correlationId });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, true);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const source = body.source;
    const persistence = await getPersistence();
    if (isGithubIssueSource(source)) {
      const project = await persistence.projects.getById(String(body.projectId ?? ""));
      const github = await loadGithubRuntime();
      if (!project || project.state !== "enabled") {
        throw new ControlError("NOT_FOUND", "The selected project is not available.");
      }
      if (!github) {
        throw new ControlError("UNAVAILABLE", "GitHub issue selection is not configured.");
      }
      const issue = (await listReadyGithubIssues(project, github))
        .find(({ number }) => number === source.issueNumber);
      if (!issue) {
        throw new ControlError("NOT_FOUND", "The selected GitHub issue is no longer ready.");
      }
    }
    const task = await createTask(persistence, {
      projectId: String(body.projectId ?? ""),
      ...(source && typeof source === "object" && !Array.isArray(source)
        ? { source: source as V0TaskSource }
        : { prompt: typeof body.prompt === "string" ? body.prompt : "" }),
    });
    await persistence.wakeups?.signal({ reason: "manual-task", projectId: task.projectId, signaledAt: new Date().toISOString() });
    return NextResponse.json({ task: sanitizeTaskRecord(task), correlationId }, { status: 201 });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}

function isGithubIssueSource(value: unknown): value is { type: "github-issue"; issueNumber: number } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    "type" in value && value.type === "github-issue" &&
    "issueNumber" in value && typeof value.issueNumber === "number" &&
    Number.isInteger(value.issueNumber) && value.issueNumber > 0;
}
