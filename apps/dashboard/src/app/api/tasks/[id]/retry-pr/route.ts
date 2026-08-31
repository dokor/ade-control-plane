import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { httpStatusForCode, ControlError } from "../../../../../lib/errors.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { sanitizeError } from "../../../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../../../lib/taskRequest.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, true);
    const { id } = await params;
    const persistence = await getPersistence();
    const task = await persistence.v0Tasks.getById(id);
    if (!task) throw new ControlError("NOT_FOUND", "Task was not found.");
    if (task.status !== "FAILED" || task.errorCode !== "GITHUB_PR_CREATE_FAILED") {
      throw new ControlError("RETRY_NOT_SAFE", "Only a diagnosed GitHub PR creation failure can be retried without rerunning the agent.");
    }
    if (!persistence.v0Tasks.requestPrRetry) throw new ControlError("UNAVAILABLE", "PR-only retry is not available on this persistence backend.");
    const updated = await persistence.v0Tasks.requestPrRetry(id, new Date().toISOString());
    return NextResponse.json({ task: updated, correlationId }, { status: 202 });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
