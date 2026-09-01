import { NextResponse } from "next/server";

import { ControlError } from "../../../../../lib/errors.js";
import { handleDashboardApi } from "../../../../../lib/dashboardApi.js";
import { getPersistence } from "../../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async () => {
    const { id } = await params;
    const persistence = await getPersistence();
    const task = await persistence.v0Tasks.getById(id);
    if (!task) throw new ControlError("NOT_FOUND", "Task was not found.");
    if (task.status !== "FAILED" || task.errorCode !== "GITHUB_PR_CREATE_FAILED") {
      throw new ControlError("RETRY_NOT_SAFE", "Only a diagnosed GitHub PR creation failure can be retried without rerunning the agent.");
    }
    if (!persistence.v0Tasks.requestPrRetry) throw new ControlError("UNAVAILABLE", "PR-only retry is not available on this persistence backend.");
    const updated = await persistence.v0Tasks.requestPrRetry(id, new Date().toISOString());
    return { body: { task: updated }, status: 202 };
  });
}
