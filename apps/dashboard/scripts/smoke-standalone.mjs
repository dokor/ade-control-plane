import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { cp, stat } from "node:fs/promises";
import path from "node:path";

const dashboardRoot = process.cwd();
const standaloneRoot = path.join(dashboardRoot, ".next", "standalone");
const runtimeRoot = path.join(standaloneRoot, "apps", "dashboard");
const serverPath = path.join(runtimeRoot, "server.js");
const staticSource = path.join(dashboardRoot, ".next", "static");
const staticTarget = path.join(runtimeRoot, ".next", "static");
const port = "3199";

await stat(serverPath);
await cp(staticSource, staticTarget, { recursive: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    PORT: port,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.equal(server.exitCode, null, `standalone server exited before becoming ready:\n${output}`);
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) break;
    } catch {
      // The process may still be binding its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  assert.ok(response?.ok, `standalone healthcheck failed:\n${output}`);
  assert.deepEqual(await response.json(), { status: "ok" });
} finally {
  server.kill("SIGTERM");
}
