import assert from "node:assert/strict";
import test from "node:test";

import { GithubAppTokenProvider } from "../src/appAuth.js";

test("repository tokens request Contents write, cache separately and renew before expiry", async () => {
  let now = Date.parse("2026-09-04T10:00:00Z");
  const bodies: unknown[] = [];
  const provider = new GithubAppTokenProvider({ credentials: { appId: "123", privateKey: "unused" }, now: () => now,
    fetchImplementation: async (_url, init) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(JSON.stringify({ token: `token-${bodies.length}`, expires_at: new Date(now + 3_600_000).toISOString() }), { status: 201 });
    },
  });
  provider.createAppJwt = () => "jwt";
  assert.equal(await provider.getRepositoryToken("42", "alpha"), "token-1");
  assert.equal(await provider.getRepositoryToken("42", "alpha"), "token-1");
  assert.equal(await provider.getRepositoryToken("42", "beta"), "token-2");
  assert.equal(await provider.getToken("42"), "token-3");
  now += 3_550_000;
  assert.equal(await provider.getRepositoryToken("42", "alpha"), "token-4");
  assert.deepEqual(bodies, [
    { repositories: ["alpha"], permissions: { contents: "write" } },
    { repositories: ["beta"], permissions: { contents: "write" } }, null,
    { repositories: ["alpha"], permissions: { contents: "write" } },
  ]);
});

test("coalesces concurrent installation token requests", async () => {
  let requests = 0;
  let releaseRequest: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const provider = new GithubAppTokenProvider({
    credentials: { appId: "123", privateKey: "unused in this test" },
    fetchImplementation: async () => {
      requests += 1;
      releaseRequest?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return new Response(JSON.stringify({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  provider.createAppJwt = () => "test-jwt";

  const first = provider.getToken("456");
  await requestStarted;
  const second = provider.getToken("456");
  assert.deepEqual(await Promise.all([first, second]), ["installation-token", "installation-token"]);
  assert.equal(requests, 1);
});
