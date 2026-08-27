import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { httpStatusForCode } from "../../../../lib/errors.js";
import { getPersistence } from "../../../../lib/persistence.js";
import { sanitizeError } from "../../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../../lib/taskRequest.js";
import { taskDetail } from "../../../../lib/tasks.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    await authorizeTaskRequest(request, false);
    const { id } = await context.params;
    const detail = await taskDetail(await getPersistence(), id);
    return NextResponse.json({ ...detail, correlationId });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
