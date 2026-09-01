export type DashboardBffLogEvent =
  | "request.started"
  | "request.completed"
  | "request.failed";

export interface DashboardLogFields {
  correlationId?: string;
  clientRequestId?: string;
  method?: string;
  endpoint?: string;
  authorization?: string;
  outcome?: "success" | "failure";
  httpStatus?: number;
  durationMs?: number;
  errorCategory?: "validation" | "github-configuration" | "github-upstream" | "control" | "transport" | "unexpected";
  errorCode?: string;
  upstreamStatus?: number;
}

/** Emits only bounded, pre-classified request metadata; never pass raw errors or payloads here. */
export function logDashboardBff(
  event: DashboardBffLogEvent,
  fields: DashboardLogFields,
): void {
  const payload = JSON.stringify({ component: "dashboard-bff", event, ...fields });
  if (event === "request.failed") console.warn("[dashboard-bff]", payload);
  else console.info("[dashboard-bff]", payload);
}

export type DashboardFrontendLogEvent =
  | "api.request.started"
  | "api.request.completed"
  | "api.request.failed";

/** Emits safe browser-side API lifecycle metadata without request bodies or error details. */
export function logDashboardFrontend(
  event: DashboardFrontendLogEvent,
  fields: DashboardLogFields,
): void {
  const payload = JSON.stringify({ component: "dashboard-frontend", event, ...fields });
  if (event === "api.request.failed") console.warn("[dashboard-frontend]", payload);
  else console.info("[dashboard-frontend]", payload);
}

export function safeDashboardEndpoint(input: RequestInfo | URL): string {
  try {
    const raw = input instanceof Request ? input.url : input.toString();
    return new URL(raw, "http://dashboard.local").pathname.slice(0, 256) || "/";
  } catch {
    return "/invalid-request";
  }
}

export function safeDashboardRequestId(value: string | null): string | undefined {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : undefined;
}

export function createDashboardRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
