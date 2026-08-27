import { createHmac, timingSafeEqual } from "node:crypto";

import { GithubRejection } from "./errors.js";
import type { GithubEventName } from "./domain.js";

/** GitHub caps deliveries at 25 MB; the control plane is far stricter. */
export const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

const SUPPORTED_EVENTS: readonly string[] = [
  "issue_comment",
  "issues",
  "pull_request",
];

export interface WebhookHeaders {
  get(name: string): string | null;
}

export interface VerifiedWebhook {
  deliveryId: string;
  event: GithubEventName;
  payload: unknown;
}

/**
 * Validates a delivery in the order required by `docs/GITHUB_INTEGRATION.md`:
 * size limit, then signature over the raw body, then headers, then JSON.
 *
 * The signature is checked before the body is parsed so a malformed or hostile
 * payload never reaches a parser on an unauthenticated path.
 */
export function verifyWebhook(
  rawBody: Buffer,
  headers: WebhookHeaders,
  secret: string,
): VerifiedWebhook {
  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new GithubRejection("PAYLOAD_TOO_LARGE", "Delivery exceeds the accepted size.");
  }

  const signature = headers.get("x-hub-signature-256");
  const deliveryId = headers.get("x-github-delivery");
  const event = headers.get("x-github-event");
  if (!signature || !deliveryId || !event) {
    throw new GithubRejection("MISSING_HEADERS", "Required GitHub headers are missing.");
  }

  if (!verifySignature(rawBody, signature, secret)) {
    throw new GithubRejection("INVALID_SIGNATURE", "Webhook signature does not match.");
  }

  if (!SUPPORTED_EVENTS.includes(event)) {
    throw new GithubRejection("UNSUPPORTED_EVENT", "Event is not subscribed to.");
  }

  return {
    deliveryId,
    event: event as GithubEventName,
    payload: parseJson(rawBody),
  };
}

/** Constant-time comparison of the `sha256=` HMAC over the exact raw bytes. */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  if (!secret) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const provided = Buffer.from(signatureHeader);
  const candidate = Buffer.from(expected);
  return (
    provided.length === candidate.length && timingSafeEqual(provided, candidate)
  );
}

function parseJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new GithubRejection("MALFORMED_PAYLOAD", "Delivery body is not valid JSON.");
  }
}
