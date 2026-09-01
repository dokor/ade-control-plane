import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../../lib/dashboardApi.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { cancelTask } from "../../../../../lib/tasks.js";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async () => {
    const { id } = await context.params;
    const task = await cancelTask(await getPersistence(), id);
    return { body: { task } };
  });
}
