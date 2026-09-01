import assert from "node:assert/strict";
import test from "node:test";

import { GithubAppTokenProvider } from "../src/appAuth.js";

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
