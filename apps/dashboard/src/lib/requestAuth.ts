import { cookies } from "next/headers";

import { authorizeBrowserMutation, authorizeRead } from "./control.js";
import { loadDashboardConfig, type DashboardConfig } from "./config.js";
import { SESSION_COOKIE_NAME, verifySessionToken, type DashboardIdentity } from "./session.js";

export interface DashboardRequestContext {
  config: DashboardConfig;
  identity: DashboardIdentity | null;
}

/** Reads the Dashboard session without deciding whether the route is public. */
export async function readDashboardRequest(): Promise<DashboardRequestContext> {
  const config = await loadDashboardConfig();
  const cookieStore = await cookies();
  const identity = verifySessionToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    { secret: config.sessionSecret, ttlMs: config.sessionTtlMs },
  );
  return { config, identity };
}

/** Applies the route's explicit read or same-origin mutation boundary. */
export async function authorizeDashboardRequest(
  request: Request,
  mutation: boolean,
): Promise<DashboardRequestContext & { identity: DashboardIdentity }> {
  const context = await readDashboardRequest();
  const identity = mutation
    ? authorizeBrowserMutation(
        context.identity,
        request.headers.get("origin"),
        context.config.publicOrigin,
      )
    : authorizeRead(context.identity);
  return { ...context, identity };
}
