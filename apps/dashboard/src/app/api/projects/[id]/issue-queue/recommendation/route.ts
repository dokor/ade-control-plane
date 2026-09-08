import { NextResponse } from "next/server";

import { handleDashboardApi, readJsonObject } from "../../../../../../lib/dashboardApi.js";
import { ControlError } from "../../../../../../lib/errors.js";
import { loadGithubRuntime } from "../../../../../../lib/githubRuntime.js";
import { recommendIssueQueue } from "../../../../../../lib/issueQueueRecommendation.js";
import { loadProjectIssueQueue } from "../../../../../../lib/projectIssueQueue.js";
import { getPersistence } from "../../../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(id: string) {
  const persistence = await getPersistence();
  const project = await persistence.projects.getById(id);
  if (!project || project.state !== "enabled") throw new ControlError("NOT_FOUND", "The selected project is not available.");
  const github = await loadGithubRuntime();
  const items = await loadProjectIssueQueue(project, persistence, github);
  return { persistence, project, github, items };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleDashboardApi(request, "read", async () => {
    const { id } = await context.params;
    const { items } = await load(id);
    return { body: { recommendation: recommendIssueQueue(items) } };
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ identity }) => {
    const { id } = await context.params;
    const body = await readJsonObject(request);
    if (!Array.isArray(body.issueNumbers) || body.issueNumbers.some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new ControlError("INVALID_COMMAND", "A valid recommendation order is required.");
    }
    const requested = body.issueNumbers as number[];
    const { persistence, project, items } = await load(id);
    if (items.some(({ projectionState }) => projectionState === "stale")) {
      throw new ControlError("CONFLICT", "GitHub work projection is stale. Refresh it before applying a recommendation.");
    }
    const recommendation = recommendIssueQueue(items);
    if (requested.length !== recommendation.issueNumbers.length || requested.some((value, index) => value !== recommendation.issueNumbers[index])) {
      throw new ControlError("CONFLICT", "The recommendation changed. Review the latest proposal before applying it.");
    }
    if (requested.length === 0) throw new ControlError("CONFLICT", "There is no safe recommendation to apply.");
    const occurredAt = new Date().toISOString();
    const preferences = await persistence.githubWork.listQueuePreferences(project.id);
    const preferred = new Set(requested);
    for (const item of items) {
      const existing = preferences.find((preference) => preference.issueNumber === item.number);
      const next = preferred.has(item.number);
      if (existing?.runWhenAvailable === next) continue;
      await persistence.githubWork.setQueuePreference({ projectId: project.id, issueNumber: item.number, runWhenAvailable: next, actorRef: identity!.actorRef, occurredAt });
    }
    await persistence.githubWork.reorderQueue({ projectId: project.id, issueNumbers: requested, actorRef: identity!.actorRef, occurredAt });
    await persistence.wakeups?.signal({ reason: "github-issue-queue-recommendation-applied", projectId: project.id, signaledAt: occurredAt });
    return { body: { items: await loadProjectIssueQueue(project, persistence, await loadGithubRuntime()), recommendation } };
  });
}
