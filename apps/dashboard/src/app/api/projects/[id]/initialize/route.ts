import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../../lib/dashboardApi.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { createTask } from "../../../../../lib/tasks.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async () => {
    const { id } = await params;
    const task = await createTask(await getPersistence(), {
      projectId: id,
      prompt: "Initialize ADE for this repository. Inspect the project, generate only the required ADE configuration files, validate them, and leave the changes ready for the worker to publish as a human-reviewed PR.",
    });
    return { body: { task }, status: 201 };
  });
}
