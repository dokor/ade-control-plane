import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../lib/dashboardApi.js";
import { getPersistence } from "../../../../lib/persistence.js";
import { taskDetail } from "../../../../lib/tasks.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "read", async () => {
    const { id } = await context.params;
    const detail = await taskDetail(await getPersistence(), id);
    return { body: detail };
  });
}
