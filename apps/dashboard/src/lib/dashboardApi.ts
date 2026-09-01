import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authorizeDashboardRequest, readDashboardRequest } from "./requestAuth.js";
import { httpStatusForCode } from "./errors.js";
import { sanitizeError } from "./sanitize.js";
import type { DashboardIdentity } from "./session.js";
import type { DashboardConfig } from "./config.js";

export type DashboardAuthorization = "read" | "mutation" | "deferred";

export interface DashboardApiContext {
  correlationId: string;
  config: DashboardConfig;
  /** `deferred` is reserved for command endpoints that audit authorization themselves. */
  identity: DashboardIdentity | null;
}

export interface DashboardApiResult {
  body: object;
  status?: number;
}

/** Runs a protected BFF handler with one consistent auth, error and correlation boundary. */
export async function handleDashboardApi(
  request: Request,
  authorization: DashboardAuthorization,
  handler: (context: DashboardApiContext) => Promise<DashboardApiResult>,
): Promise<NextResponse> {
  const correlationId = randomUUID();

  try {
    const requestContext = authorization === "deferred"
      ? await readDashboardRequest()
      : await authorizeDashboardRequest(request, authorization === "mutation");
    const result = await handler({ ...requestContext, correlationId });
    return NextResponse.json(
      { ...result.body, correlationId },
      { status: result.status ?? 200 },
    );
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}

/** Parses browser JSON bodies without allowing malformed input to escape the BFF. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}
