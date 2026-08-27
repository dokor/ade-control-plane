import assert from "node:assert/strict";
import test from "node:test";

import {
  clearedSessionCookie,
  hashOperatorPassword,
  issueSessionToken,
  readCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
  verifyOperatorPassword,
  verifySessionToken,
} from "../src/lib/session.js";

const config = { secret: "test-secret", ttlMs: 60_000 };
const identity = { actorRef: "dokor", canRead: true, canMutate: true };

test("round-trips a signed session", () => {
  const token = issueSessionToken(identity, config, 1_000);
  const session = verifySessionToken(token, config, 2_000);
  assert.equal(session?.actorRef, "dokor");
  assert.equal(session?.canMutate, true);
});

test("rejects tampered, foreign and expired tokens", () => {
  const token = issueSessionToken(identity, config, 1_000);
  const [payload] = token.split(".");
  assert.equal(verifySessionToken(`${payload}.forged`, config, 2_000), null);
  assert.equal(
    verifySessionToken(token, { secret: "other-secret", ttlMs: 60_000 }, 2_000),
    null,
  );
  assert.equal(verifySessionToken(token, config, 100_000), null);
  assert.equal(verifySessionToken(undefined, config, 2_000), null);
  assert.equal(verifySessionToken("not-a-token", config, 2_000), null);
});

test("session cookie is HttpOnly, SameSite and Secure over https", () => {
  const cookie = serializeSessionCookie("token", { secure: true, maxAgeSeconds: 60 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  assert.match(clearedSessionCookie(true), /Max-Age=0/);
});

test("reads the session cookie out of a cookie header", () => {
  assert.equal(
    readCookie(`other=1; ${SESSION_COOKIE_NAME}=abc; last=2`, SESSION_COOKIE_NAME),
    "abc",
  );
  assert.equal(readCookie(null, SESSION_COOKIE_NAME), null);
});

test("verifies operator passwords and fails closed on malformed hashes", () => {
  const stored = hashOperatorPassword("correct horse", undefined, 1_024);
  assert.equal(verifyOperatorPassword("correct horse", stored), true);
  assert.equal(verifyOperatorPassword("wrong", stored), false);
  assert.equal(verifyOperatorPassword("correct horse", "plaintext"), false);
  assert.equal(verifyOperatorPassword("correct horse", ""), false);
});
