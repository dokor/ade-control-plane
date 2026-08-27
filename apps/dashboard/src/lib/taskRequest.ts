import { cookies } from "next/headers";
import { authorizeBrowserMutation, authorizeRead } from "./control.js";
import { loadDashboardConfig } from "./config.js";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session.js";

export async function authorizeTaskRequest(request: Request, mutation: boolean) {
  const config = await loadDashboardConfig();
  const cookieStore = await cookies();
  const identity = verifySessionToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    { secret: config.sessionSecret, ttlMs: config.sessionTtlMs },
  );

  return mutation
    ? authorizeBrowserMutation(
        identity,
        request.headers.get("origin"),
        config.publicOrigin,
      )
    : authorizeRead(identity);
}
