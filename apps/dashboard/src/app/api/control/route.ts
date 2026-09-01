import { NextResponse } from "next/server";

import { submitDashboardCommand } from "../../../lib/commands.js";
import { handleDashboardApi, readJsonObject } from "../../../lib/dashboardApi.js";
import { getPersistence } from "../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only mutation endpoint of the Dashboard.
 *
 * It accepts typed control commands and nothing else: there is no generic
 * shell, process, path or SQL surface reachable from the browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handleDashboardApi(request, "deferred", async ({ correlationId, config, identity }) => {
    const parsed = await readJsonObject(request);
    const outcome = await submitDashboardCommand(
      {
        persistence: await getPersistence(),
        identity,
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

    return { body: outcome };
  });
}
