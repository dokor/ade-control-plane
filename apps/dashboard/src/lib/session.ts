import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { ControlError } from "./errors.js";

export const SESSION_COOKIE_NAME = "ade_cp_session";

/** Authorization facts a handler is allowed to reason about. */
export interface DashboardIdentity {
  actorRef: string;
  canRead: boolean;
  canMutate: boolean;
}

export interface DashboardSession extends DashboardIdentity {
  issuedAt: number;
  expiresAt: number;
}

export interface SessionConfig {
  secret: string;
  ttlMs: number;
}

interface SessionPayload {
  sub: string;
  read: boolean;
  mutate: boolean;
  iat: number;
  exp: number;
}

const SCRYPT_KEY_LENGTH = 64;

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/** Mints an HMAC-signed, self-contained session token. No server-side store. */
export function issueSessionToken(
  identity: DashboardIdentity,
  config: SessionConfig,
  now: number = Date.now(),
): string {
  const payload: SessionPayload = {
    sub: identity.actorRef,
    read: identity.canRead,
    mutate: identity.canMutate,
    iat: now,
    exp: now + config.ttlMs,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, config.secret)}`;
}

/**
 * Returns the session only when the signature verifies and the token is not
 * expired. Any tampering, truncation or clock expiry yields `null`; callers
 * must treat `null` as unauthenticated rather than as a degraded session.
 */
export function verifySessionToken(
  token: string | undefined | null,
  config: SessionConfig,
  now: number = Date.now(),
): DashboardSession | null {
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(encoded, config.secret))) return null;

  const payload = decodePayload(encoded);
  if (!payload || payload.exp <= now) return null;

  return {
    actorRef: payload.sub,
    canRead: payload.read,
    canMutate: payload.mutate,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

function decodePayload(encoded: string): SessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.sub !== "string" ||
      typeof candidate.read !== "boolean" ||
      typeof candidate.mutate !== "boolean" ||
      typeof candidate.iat !== "number" ||
      typeof candidate.exp !== "number"
    ) {
      return null;
    }

    return {
      sub: candidate.sub,
      read: candidate.read,
      mutate: candidate.mutate,
      iat: candidate.iat,
      exp: candidate.exp,
    };
  } catch {
    return null;
  }
}

export interface CookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

/**
 * `HttpOnly` keeps the token away from scripts, `SameSite=Lax` stops
 * cross-site form posts from carrying it, and `Secure` is only dropped for
 * local HTTP development.
 */
export function serializeSessionCookie(
  token: string,
  options: CookieOptions,
): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.trunc(options.maxAgeSeconds))}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  return serializeSessionCookie("", { secure, maxAgeSeconds: 0 });
}

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/** `scrypt$N$r$p$salt$hash`, so the stored value carries its own parameters. */
export function hashOperatorPassword(
  password: string,
  salt: Buffer = randomBytes(16),
  cost = 16_384,
  blockSize = 8,
  parallelization = 1,
): string {
  const derived = scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEY_LENGTH, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 128 * cost * blockSize * 4,
  });
  return [
    "scrypt",
    String(cost),
    String(blockSize),
    String(parallelization),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/** Constant-time password check. Malformed stored hashes fail closed. */
export function verifyOperatorPassword(password: string, stored: string): boolean {
  const parts = stored.trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  const salt = parts[4];
  const expected = parts[5];
  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization) ||
    salt === undefined ||
    expected === undefined
  ) {
    return false;
  }

  try {
    const candidate = scryptSync(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64url"),
      SCRYPT_KEY_LENGTH,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 128 * cost * blockSize * 4,
      },
    );
    return safeEqual(candidate.toString("base64url"), expected);
  } catch {
    return false;
  }
}

export function requireSession(
  session: DashboardSession | null,
): DashboardSession {
  if (!session || !session.canRead) {
    throw new ControlError("UNAUTHENTICATED", "Authentication is required.");
  }
  return session;
}
