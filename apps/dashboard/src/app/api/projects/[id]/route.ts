import { NextResponse } from "next/server";

import { handleDashboardApi, readJsonObject } from "../../../../lib/dashboardApi.js";
import { ControlError } from "../../../../lib/errors.js";
import { getPersistence } from "../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async () => {
    const { id } = await params;
    const body = await readJsonObject(request);
    const persistence = await getPersistence();
    const project = await persistence.projects.getById(id);
    if (!project) throw new ControlError("NOT_FOUND", "Project was not found.");
    if (body.confirmationName !== project.name) {
      throw new ControlError("INVALID_COMMAND", "Type the exact project name to confirm deletion.");
    }
    await persistence.projects.requestDeletion(project.id, new Date().toISOString());
    return { body: { projectId: project.id, status: "queued" }, status: 202 };
  });
}
