import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { loadDashboardConfig } from "../../../lib/config.js";
import { getPersistence } from "../../../lib/persistence.js";
import { sanitizeError } from "../../../lib/sanitize.js";
import {
  clearedSessionCookie,
  issueSessionToken,
  serializeSessionCookie,
  verifyOperatorPassword,
} from "../../../lib/session.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign-in. Always audited; the password itself is never logged or echoed. */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  const now = new Date().toISOString();

  try {
    const config = await loadDashboardConfig();
    if (request.headers.get("origin") !== config.publicOrigin) {
      return NextResponse.json(
        { code: "CSRF_REJECTED", summary: "Unexpected request origin.", correlationId },
        { status: 403 },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const password =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).password
        : undefined;
    const accepted =
      typeof password === "string" &&
      verifyOperatorPassword(password, config.operatorPasswordHash);

    await auditSignIn(config.operatorRef, accepted, correlationId, now);

    if (!accepted) {
      return NextResponse.json(
        {
          code: "UNAUTHENTICATED",
          summary: "Invalid credentials.",
          correlationId,
        },
        { status: 401 },
      );
    }

    const token = issueSessionToken(
      { actorRef: config.operatorRef, canRead: true, canMutate: true },
      { secret: config.sessionSecret, ttlMs: config.sessionTtlMs },
    );
    const response = NextResponse.json({ status: "authenticated" });
    response.headers.set(
      "set-cookie",
      serializeSessionCookie(token, {
        secure: config.cookieSecure,
        maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
      }),
    );
    return response;
  } catch (error) {
    const sanitized = sanitizeError(error, correlationId);
    return NextResponse.json(sanitized, { status: 500 });
  }
}

/** Sign-out clears the cookie unconditionally. */
export async function DELETE(): Promise<NextResponse> {
  const config = await loadDashboardConfig();
  const response = NextResponse.json({ status: "signed-out" });
  response.headers.set("set-cookie", clearedSessionCookie(config.cookieSecure));
  return response;
}

async function auditSignIn(
  actorRef: string,
  accepted: boolean,
  correlationId: string,
  now: string,
): Promise<void> {
  try {
    const persistence = await getPersistence();
    await persistence.auditEvents.append({
      occurredAt: now,
      category: "security",
      severity: accepted ? "info" : "warning",
      actorType: "operator",
      actorRef: accepted ? actorRef : null,
      action: accepted ? "session.granted" : "session.denied",
      result: accepted ? "granted" : "denied",
      correlationId,
    });
  } catch {
    // A persistence outage must not turn into an authentication bypass signal;
    // the request still fails or succeeds on credential verification alone.
  }
}
