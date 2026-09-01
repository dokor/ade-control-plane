import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../../lib/dashboardApi.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { createTask } from "../../../../../lib/tasks.js";
import { sanitizeTaskRecord } from "../../../../../lib/taskReadModel.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async () => {
    const { id } = await params;
    const persistence = await getPersistence();
    const task = await createTask(persistence, {
      projectId: id,
      source: { type: "ade-initialize" },
    });
    await persistence.wakeups?.signal({
      reason: "manual-task",
      projectId: task.projectId,
      signaledAt: new Date().toISOString(),
    });
    return { body: { task: sanitizeTaskRecord(task) }, status: 201 };
  });
}
