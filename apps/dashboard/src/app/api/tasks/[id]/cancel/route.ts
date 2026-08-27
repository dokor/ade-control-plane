import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { httpStatusForCode } from "../../../../../lib/errors.js";
import { getPersistence } from "../../../../../lib/persistence.js";
import { sanitizeError } from "../../../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../../../lib/taskRequest.js";
import { cancelTask } from "../../../../../lib/tasks.js";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, true);
    const { id } = await context.params;
    const task = await cancelTask(await getPersistence(), id);
    return NextResponse.json({ task, correlationId });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
