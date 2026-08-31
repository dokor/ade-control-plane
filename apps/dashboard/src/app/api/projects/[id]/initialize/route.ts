import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { httpStatusForCode } from "../../../../../lib/errors.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { sanitizeError } from "../../../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../../../lib/taskRequest.js";
import { createTask } from "../../../../../lib/tasks.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, true);
    const { id } = await params;
    const task = await createTask(await getPersistence(), {
      projectId: id,
      prompt: "Initialize ADE for this repository. Inspect the project, generate only the required ADE configuration files, validate them, and leave the changes ready for the worker to publish as a human-reviewed PR.",
    });
    return NextResponse.json({ task, correlationId }, { status: 201 });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
