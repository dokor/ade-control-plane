import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authorizeDashboardRequest, readDashboardRequest } from "./requestAuth.js";
import { httpStatusForCode, isControlError } from "./errors.js";
import { sanitizeError } from "./sanitize.js";
import { logDashboardBff, safeDashboardRequestId, type DashboardLogFields } from "./observability.js";
import { GithubApiError } from "@ade-control-plane/github";
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
  const startedAt = Date.now();
  const endpoint = new URL(request.url).pathname.slice(0, 256) || "/";
  const clientRequestId = safeDashboardRequestId(request.headers.get("x-dashboard-request-id"));
  const baseLog = {
    correlationId,
    ...(clientRequestId ? { clientRequestId } : {}),
    method: request.method.slice(0, 16),
    endpoint,
    authorization,
  } satisfies DashboardLogFields;
  logDashboardBff("request.started", baseLog);

  try {
    const requestContext = authorization === "deferred"
      ? await readDashboardRequest()
      : await authorizeDashboardRequest(request, authorization === "mutation");
    const result = await handler({ ...requestContext, correlationId });
    const response = NextResponse.json(
      { ...result.body, correlationId },
      { status: result.status ?? 200 },
    );
    logDashboardBff("request.completed", {
      ...baseLog,
      outcome: "success",
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    const status = httpStatusForCode(safe.code);
    logDashboardBff("request.failed", {
      ...baseLog,
      outcome: "failure",
      httpStatus: status,
      durationMs: Date.now() - startedAt,
      errorCategory: classifyBffError(error, endpoint),
      errorCode: safe.code,
      ...(error instanceof GithubApiError ? { upstreamStatus: error.status } : {}),
    });
    return NextResponse.json(safe, { status });
  }
}

function classifyBffError(
  error: unknown,
  endpoint: string,
): Exclude<DashboardLogFields["errorCategory"], undefined> {
  if (error instanceof GithubApiError) return "github-upstream";
  if (isControlError(error)) {
    if (error.code === "UNAVAILABLE" && (endpoint.startsWith("/api/github/") || endpoint === "/api/tasks")) {
      return "github-configuration";
    }
    if (error.code === "INVALID_COMMAND" || error.code === "NOT_FOUND") return "validation";
    return "control";
  }
  return "unexpected";
}

/** Parses browser JSON bodies without allowing malformed input to escape the BFF. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}
