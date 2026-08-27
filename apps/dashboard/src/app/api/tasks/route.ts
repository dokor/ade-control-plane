import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { httpStatusForCode } from "../../../lib/errors.js";
import { getPersistence } from "../../../lib/persistence.js";
import { sanitizeError } from "../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../lib/taskRequest.js";
import { createTask } from "../../../lib/tasks.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, false);
    const tasks = await (await getPersistence()).v0Tasks.list(100);
    return NextResponse.json({ tasks, correlationId });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, true);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const task = await createTask(await getPersistence(), {
      projectId: String(body.projectId ?? ""),
      prompt: String(body.prompt ?? ""),
    });
    return NextResponse.json({ task, correlationId }, { status: 201 });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
