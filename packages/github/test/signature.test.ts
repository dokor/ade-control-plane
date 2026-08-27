import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { MAX_WEBHOOK_BODY_BYTES, verifySignature, verifyWebhook } from "../src/signature.js";

const SECRET = "webhook-secret";

function headers(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    "x-github-delivery": "delivery-1",
    "x-github-event": "issue_comment",
    "x-hub-signature-256": "",
    ...overrides,
  };
  return { get: (name: string) => base[name.toLowerCase()] ?? null };
}

function sign(body: Buffer, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("accepts a correctly signed delivery", () => {
  const body = Buffer.from(JSON.stringify({ action: "created" }));
  const verified = verifyWebhook(body, headers({ "x-hub-signature-256": sign(body) }), SECRET);

  assert.equal(verified.deliveryId, "delivery-1");
  assert.equal(verified.event, "issue_comment");
});

test("rejects a forged or foreign signature", () => {
  const body = Buffer.from(JSON.stringify({ action: "created" }));
  assert.throws(
    () => verifyWebhook(body, headers({ "x-hub-signature-256": "sha256=00" }), SECRET),
    /INVALID_SIGNATURE/,
  );
  assert.throws(
    () =>
      verifyWebhook(
        body,
        headers({ "x-hub-signature-256": sign(body, "other-secret") }),
        SECRET,
      ),
    /INVALID_SIGNATURE/,
  );
});

test("rejects a signature computed over different bytes", () => {
  const body = Buffer.from(JSON.stringify({ action: "created" }));
  const tampered = Buffer.from(JSON.stringify({ action: "deleted" }));
  assert.throws(
    () => verifyWebhook(tampered, headers({ "x-hub-signature-256": sign(body) }), SECRET),
    /INVALID_SIGNATURE/,
  );
});

test("fails closed when no secret is configured", () => {
  const body = Buffer.from("{}");
  assert.equal(verifySignature(body, sign(body), ""), false);
});

test("requires delivery, event and signature headers", () => {
  const body = Buffer.from("{}");
  for (const missing of ["x-github-delivery", "x-github-event", "x-hub-signature-256"]) {
    assert.throws(
      () =>
        verifyWebhook(
          body,
          headers({ "x-hub-signature-256": sign(body), [missing]: null }),
          SECRET,
        ),
      /MISSING_HEADERS/,
    );
  }
});

test("refuses oversized bodies before doing any work", () => {
  const body = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES + 1);
  assert.throws(() => verifyWebhook(body, headers(), SECRET), /PAYLOAD_TOO_LARGE/);
});

test("refuses unsubscribed events and malformed json", () => {
  const body = Buffer.from("{}");
  assert.throws(
    () =>
      verifyWebhook(
        body,
        headers({ "x-hub-signature-256": sign(body), "x-github-event": "push" }),
        SECRET,
      ),
    /UNSUPPORTED_EVENT/,
  );

  const broken = Buffer.from("{not json");
  assert.throws(
    () => verifyWebhook(broken, headers({ "x-hub-signature-256": sign(broken) }), SECRET),
    /MALFORMED_PAYLOAD/,
  );
});
