import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { loadDashboardConfig, type DashboardConfig } from "./config.js";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type DashboardSession,
} from "./session.js";

export interface AuthenticatedContext {
  session: DashboardSession;
  config: DashboardConfig;
}

/** Reads and verifies the session cookie. Returns `null` when unauthenticated. */
export async function readSession(): Promise<{
  session: DashboardSession | null;
  config: DashboardConfig;
}> {
  const config = await loadDashboardConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return {
    session: verifySessionToken(token, {
      secret: config.sessionSecret,
      ttlMs: config.sessionTtlMs,
    }),
    config,
  };
}

/**
 * Every protected server component calls this. Authentication is enforced on
 * the server per request, not by middleware alone, so a direct request to the
 * app (bypassing any reverse proxy) cannot reach protected data.
 */
export async function requireAuthenticatedContext(
  returnTo = "/",
): Promise<AuthenticatedContext> {
  const { session, config } = await readSession();
  if (!session?.canRead) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return { session, config };
}

/** Origin used for same-origin checks, preferring the configured public URL. */
export async function resolveRequestOrigin(): Promise<string | null> {
  const headerStore = await headers();
  return headerStore.get("origin");
}
