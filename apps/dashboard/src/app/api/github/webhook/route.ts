import { randomUUID } from "node:crypto";

import { MAX_WEBHOOK_BODY_BYTES } from "@ade-control-plane/github";
import { NextResponse } from "next/server";

import { loadGithubRuntime } from "../../../../lib/githubRuntime.js";
import { handleGithubDelivery } from "../../../../lib/githubWebhook.js";
import { getPersistence } from "../../../../lib/persistence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, signature-authenticated GitHub webhook endpoint.
 *
 * It is deliberately the only unauthenticated-by-session route in the app, and
 * it performs no privileged work: at most it persists a typed `ControlCommand`
 * that the worker consumes later.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();

  try {
    const github = await loadGithubRuntime();
    if (!github) {
      return NextResponse.json(
        { status: "disabled", correlationId },
        { status: 503 },
      );
    }

    // The raw bytes are required for signature validation, so the body is read
    // once and never re-serialized before verification.
    const rawBody = Buffer.from(await request.arrayBuffer());
    if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json(
        { status: "rejected", code: "PAYLOAD_TOO_LARGE", correlationId },
        { status: 413 },
      );
    }

    const outcome = await handleGithubDelivery(
      {
        persistence: await getPersistence(),
        webhookSecret: github.webhookSecret,
        policy: github.policy,
        dashboardUrl: github.dashboardUrl,
        quotaProvider: github.quotaProvider,
        quotaAccountRef: github.quotaAccountRef,
        client: github.client,
        correlationId,
      },
      rawBody,
      request.headers,
    );

    return NextResponse.json(
      { ...outcome, correlationId },
      { status: outcome.status === "rejected" ? outcome.httpStatus : 202 },
    );
  } catch {
    // Never echo an exception to an unauthenticated caller.
    return NextResponse.json(
      { status: "error", correlationId },
      { status: 500 },
    );
  }
}
