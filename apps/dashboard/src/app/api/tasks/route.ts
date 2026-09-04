import { NextResponse } from "next/server";
import type { V0TaskSource } from "@ade-control-plane/database";

import { ControlError } from "../../../lib/errors.js";
import { handleDashboardApi, readJsonObject } from "../../../lib/dashboardApi.js";
import { listGithubIssues } from "../../../lib/githubIssues.js";
import { admitGithubIssue } from "../../../lib/githubIssueAdmission.js";
import { loadGithubRuntime } from "../../../lib/githubRuntime.js";
import { getPersistence } from "../../../lib/persistence.js";
import { createTask } from "../../../lib/tasks.js";
import { sanitizeTaskRecord } from "../../../lib/taskReadModel.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  return handleDashboardApi(request, "read", async () => {
    const tasks = (await (await getPersistence()).v0Tasks.list(100)).map(sanitizeTaskRecord);
    return { body: { tasks } };
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ identity }) => {
    const body = await readJsonObject(request);
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
      const issue = (await listGithubIssues(project, github))
        .find(({ number }) => number === source.issueNumber);
      if (!issue) {
        throw new ControlError("NOT_FOUND", "The selected GitHub issue is no longer open or accessible.");
      }
      if (!github.client) throw new ControlError("UNAVAILABLE", "GitHub issue admission is not configured.");
      const removedAt = await persistence.githubWork.getRemoval(project.id, source.issueNumber);
      const admission = await admitGithubIssue(project, github.client, source.issueNumber, removedAt !== null);
      if (removedAt && !await persistence.githubWork.readmit({ projectId: project.id, issueNumber: source.issueNumber,
        removedAt, actorRef: identity!.actorRef, occurredAt: new Date().toISOString() })) {
        throw new ControlError("CONFLICT", "The removal state changed. Refresh before admitting this issue again.");
      }
      await persistence.wakeups?.signal({ reason: "github-work-admitted", projectId: project.id, signaledAt: new Date().toISOString() });
      return { body: { githubWork: admission }, status: 202 };
    }
    const task = await createTask(persistence, {
      projectId: String(body.projectId ?? ""),
      ...(source && typeof source === "object" && !Array.isArray(source)
        ? { source: source as V0TaskSource }
        : { prompt: typeof body.prompt === "string" ? body.prompt : "" }),
    });
    await persistence.wakeups?.signal({ reason: "manual-task", projectId: task.projectId, signaledAt: new Date().toISOString() });
    return { body: { task: sanitizeTaskRecord(task) }, status: 201 };
  });
}

function isGithubIssueSource(value: unknown): value is { type: "github-issue"; issueNumber: number } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    "type" in value && value.type === "github-issue" &&
    "issueNumber" in value && typeof value.issueNumber === "number" &&
    Number.isInteger(value.issueNumber) && value.issueNumber > 0;
}
