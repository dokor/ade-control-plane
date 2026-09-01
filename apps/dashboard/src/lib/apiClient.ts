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
  const response = await fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new DashboardApiError(
      isDashboardErrorPayload(body) ? body : {},
      fallback,
    );
  }
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
