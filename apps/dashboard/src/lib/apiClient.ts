import {
  createDashboardRequestId,
  logDashboardFrontend,
  safeDashboardEndpoint,
} from "./observability.js";

export interface DashboardErrorPayload {
  code?: string;
  summary?: string;
  correlationId?: string;
}

export class DashboardApiError extends Error {
  public readonly code: string;
  public readonly correlationId: string | null;

  public constructor(payload: DashboardErrorPayload, fallback: string) {
    super(payload.summary || fallback);
    this.name = "DashboardApiError";
    this.code = payload.code ?? "ERROR";
    this.correlationId = payload.correlationId ?? null;
  }
}

/** Shared browser boundary for JSON BFF calls and sanitized API errors. */
export async function requestDashboardJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fallback = "The Dashboard request failed.",
): Promise<T> {
  const startedAt = Date.now();
  const endpoint = safeDashboardEndpoint(input);
  const clientRequestId = createDashboardRequestId();
  const headers = new Headers(init.headers);
  headers.set("x-dashboard-request-id", clientRequestId);
  logDashboardFrontend("api.request.started", {
    clientRequestId,
    method: (init.method ?? "GET").toUpperCase().slice(0, 16),
    endpoint,
  });

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? "same-origin",
    });
  } catch (error) {
    logDashboardFrontend("api.request.failed", {
      clientRequestId,
      method: (init.method ?? "GET").toUpperCase().slice(0, 16),
      endpoint,
      durationMs: Date.now() - startedAt,
      errorCategory: "transport",
      errorCode: "NETWORK_ERROR",
    });
    throw error;
  }
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new DashboardApiError(
      isDashboardErrorPayload(body) ? body : {},
      fallback,
    );
    logDashboardFrontend("api.request.failed", {
      clientRequestId,
      ...(error.correlationId ? { correlationId: error.correlationId } : {}),
      method: (init.method ?? "GET").toUpperCase().slice(0, 16),
      endpoint,
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      errorCategory: "control",
      errorCode: error.code,
    });
    throw error;
  }
  logDashboardFrontend("api.request.completed", {
    clientRequestId,
    ...(isDashboardErrorPayload(body) && typeof body.correlationId === "string"
      ? { correlationId: body.correlationId }
      : {}),
    method: (init.method ?? "GET").toUpperCase().slice(0, 16),
    endpoint,
    durationMs: Date.now() - startedAt,
    httpStatus: response.status,
    outcome: "success",
  });
  return body as T;
}

export function dashboardErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DashboardApiError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : fallback;
}

function isDashboardErrorPayload(value: unknown): value is DashboardErrorPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
