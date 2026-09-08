import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../../lib/dashboardApi.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { archiveTask } from "../../../../../lib/tasks.js";
import { sanitizeTaskRecord } from "../../../../../lib/taskReadModel.js";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ identity }) => {
    const { id } = await context.params;
    const result = await archiveTask(await getPersistence(), id, identity!.actorRef);
    return { body: { task: sanitizeTaskRecord(result.task), alreadyArchived: result.alreadyArchived } };
  });
}
