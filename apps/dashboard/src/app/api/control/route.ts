import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { submitDashboardCommand } from "../../../lib/commands.js";
import { loadDashboardConfig } from "../../../lib/config.js";
import { getPersistence } from "../../../lib/persistence.js";
import { sanitizeError } from "../../../lib/sanitize.js";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../lib/session.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only mutation endpoint of the Dashboard.
 *
 * It accepts typed control commands and nothing else: there is no generic
 * shell, process, path or SQL surface reachable from the browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();

  try {
    const config = await loadDashboardConfig();
    const cookieStore = await cookies();
    const session = verifySessionToken(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
      { secret: config.sessionSecret, ttlMs: config.sessionTtlMs },
    );
    const body: unknown = await request.json().catch(() => null);
    const parsed =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    const outcome = await submitDashboardCommand(
      {
        persistence: await getPersistence(),
        identity: session,
        requestOrigin: request.headers.get("origin"),
        expectedOrigin: config.publicOrigin,
        now: new Date().toISOString(),
        correlationId,
      },
      {
        type: String(parsed.type ?? ""),
        payload: parsed.payload,
        idempotencyKey:
          typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : null,
      },
    );

    return NextResponse.json({ ...outcome, correlationId });
  } catch (error) {
    const sanitized = sanitizeError(error, correlationId);
    return NextResponse.json(sanitized, {
      status: statusForCode(sanitized.code),
    });
  }
}

function statusForCode(code: string): number {
  const statuses: Readonly<Record<string, number>> = {
    UNAUTHENTICATED: 401,
    CSRF_REJECTED: 403,
    FORBIDDEN: 403,
    UNKNOWN_COMMAND: 400,
    INVALID_COMMAND: 400,
    RETRY_NOT_SAFE: 409,
    NOT_FOUND: 404,
    CONFLICT: 409,
  };
  return statuses[code] ?? 500;
}
