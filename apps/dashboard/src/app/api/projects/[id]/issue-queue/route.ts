import { NextResponse } from "next/server";

import { handleDashboardApi, readJsonObject } from "../../../../../lib/dashboardApi.js";
import { ControlError } from "../../../../../lib/errors.js";
import { admitGithubIssue } from "../../../../../lib/githubIssueAdmission.js";
import { loadGithubRuntime } from "../../../../../lib/githubRuntime.js";
import { loadProjectIssueQueue } from "../../../../../lib/projectIssueQueue.js";
import { getPersistence } from "../../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleDashboardApi(request, "read", async () => {
    const { id } = await context.params;
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(id);
    if (!project || project.state !== "enabled") throw new ControlError("NOT_FOUND", "The selected project is not available.");
    return { body: { items: await loadProjectIssueQueue(project, persistence, await loadGithubRuntime()) } };
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ identity }) => {
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const issueNumber = typeof body.issueNumber === "number" ? body.issueNumber : null;
    const runWhenAvailable = body.runWhenAvailable;
    if (issueNumber === null || !Number.isSafeInteger(issueNumber) || issueNumber < 1 || typeof runWhenAvailable !== "boolean") {
      throw new ControlError("INVALID_COMMAND", "A positive issue number and Run when worker available state are required.");
    }
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(id);
    const github = await loadGithubRuntime();
    if (!project || project.state !== "enabled") throw new ControlError("NOT_FOUND", "The selected project is not available.");
    const items = await loadProjectIssueQueue(project, persistence, github);
    const item = items.find((candidate) => candidate.number === issueNumber);
    if (!item) throw new ControlError("NOT_FOUND", "The selected GitHub issue is no longer open or accessible.");
    if (item.projectionState !== "current") throw new ControlError("CONFLICT", "GitHub work projection is stale or unknown. Refresh it before changing this issue.");
    if (runWhenAvailable && !github?.client) throw new ControlError("UNAVAILABLE", "GitHub issue admission is not configured.");
    const occurredAt = new Date().toISOString();
    if (runWhenAvailable) {
      const removedAt = await persistence.githubWork.getRemoval(project.id, issueNumber);
      await admitGithubIssue(project, github!.client!, issueNumber, removedAt !== null);
      if (removedAt && !await persistence.githubWork.readmit({ projectId: project.id, issueNumber, removedAt, actorRef: identity!.actorRef, occurredAt })) {
        throw new ControlError("CONFLICT", "The removal state changed. Refresh before enabling this issue.");
      }
    }
    await persistence.githubWork.setQueuePreference({ projectId: project.id, issueNumber, runWhenAvailable, actorRef: identity!.actorRef, occurredAt });
    await persistence.wakeups?.signal({ reason: "github-issue-queue-updated", projectId: project.id, signaledAt: occurredAt });
    return { body: { items: await loadProjectIssueQueue(project, persistence, github) } };
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ identity }) => {
    const { id } = await context.params;
    const body = await readJsonObject(request);
    if (!Array.isArray(body.issueNumbers) || body.issueNumbers.some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new ControlError("INVALID_COMMAND", "Queue order must contain positive issue numbers.");
    }
    const issueNumbers = body.issueNumbers as number[];
    if (new Set(issueNumbers).size !== issueNumbers.length) throw new ControlError("INVALID_COMMAND", "Queue order must not contain an issue more than once.");
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(id);
    const github = await loadGithubRuntime();
    if (!project || project.state !== "enabled") throw new ControlError("NOT_FOUND", "The selected project is not available.");
    const items = await loadProjectIssueQueue(project, persistence, github);
    const enabled = items.filter(({ runWhenAvailable }) => runWhenAvailable);
    if (enabled.some(({ projectionState }) => projectionState !== "current")) {
      throw new ControlError("CONFLICT", "GitHub work projection is stale. Refresh it before changing the queue.");
    }
    const enabledNumbers = enabled.map(({ number }) => number).toSorted((left, right) => left - right);
    if (enabledNumbers.length !== issueNumbers.length || enabledNumbers.some((value, index) => value !== [...issueNumbers].toSorted((left, right) => left - right)[index])) {
      throw new ControlError("CONFLICT", "Queue order must include every enabled, open issue exactly once.");
    }
    const occurredAt = new Date().toISOString();
    // Legacy ready work had no explicit preference. Materialize it only when
    // the operator first changes the order, preserving prior auto-run behavior.
    for (const item of enabled) {
      const preferences = await persistence.githubWork.listQueuePreferences(project.id);
      if (!preferences.some((preference) => preference.issueNumber === item.number)) {
        await persistence.githubWork.setQueuePreference({ projectId: project.id, issueNumber: item.number, runWhenAvailable: true, actorRef: identity!.actorRef, occurredAt });
      }
    }
    await persistence.githubWork.reorderQueue({ projectId: project.id, issueNumbers, actorRef: identity!.actorRef, occurredAt });
    await persistence.wakeups?.signal({ reason: "github-issue-queue-reordered", projectId: project.id, signaledAt: occurredAt });
    return { body: { items: await loadProjectIssueQueue(project, persistence, github) } };
  });
}
