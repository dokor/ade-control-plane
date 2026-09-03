import { NextResponse } from "next/server";

import { handleDashboardApi } from "../../../../lib/dashboardApi.js";
import { ControlError } from "../../../../lib/errors.js";
import { getPersistence } from "../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Queues a worker-owned, forced read from the Codex App Server quota source. */
export async function POST(request: Request): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ correlationId, config, identity }) => {
    if (!identity) throw new ControlError("UNAUTHENTICATED", "Authentication is required.");
    const persistence = await getPersistence();
    if (!persistence.wakeups) {
      throw new ControlError("UNAVAILABLE", "The worker wakeup channel is unavailable.");
    }

    const signaledAt = new Date().toISOString();
    await persistence.wakeups.signal({
      reason: "quota-refresh",
      projectId: null,
      signaledAt,
    });
    await persistence.auditEvents.append({
      occurredAt: signaledAt,
      category: "quota",
      severity: "info",
      actorType: "dashboard",
      actorRef: identity.actorRef,
      action: "quota.refresh.requested",
      result: "queued",
      correlationId,
      metadata: { provider: config.quotaProvider, accountRef: config.quotaAccountRef },
    });

    return {
      body: {
        result: {
          queued: true,
          summary: "Quota refresh requested; the worker will read the provider before its next dispatch.",
        },
      },
      status: 202,
    };
  });
}
