import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const entrypoint = fileURLToPath(new URL("../bin/worker-entrypoint", import.meta.url));

async function executable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function fakeRuntime({ curlScript, fakeSleep = false }) {
  const root = await mkdtemp(join(tmpdir(), "ade-worker-entrypoint-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await executable(join(bin, "codex"), "#!/usr/bin/env bash\ntrap 'exit 0' TERM INT\nwhile :; do /bin/sleep 1; done\n");
  await executable(join(bin, "curl"), curlScript);
  if (fakeSleep) await executable(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  return { root, bin };
}

test("worker entrypoint hides transient readiness noise and reports worker exit status", async () => {
  const { root, bin } = await fakeRuntime({
    curlScript: `#!/usr/bin/env bash\ncount_file=\"${join(tmpdir(), `ade-curl-${process.pid}`)}\"\ncount=0\n[[ -f \"$count_file\" ]] && count=\"$(cat \"$count_file\")\"\ncount=$((count + 1))\nprintf '%s' \"$count\" > \"$count_file\"\nif (( count < 3 )); then\n  printf 'curl: simulated unavailable\\n' >&2\n  exit 7\nfi\nexit 0\n`,
    fakeSleep: true,
  });

  const result = spawnSync(entrypoint, ["bash", "-c", "exit 17"], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.equal(result.status, 17, result.stderr);
  assert.match(result.stderr, /worker process exited with status 17/u);
  assert.doesNotMatch(result.stderr, /curl: simulated unavailable/u);
});

test("worker entrypoint emits only the terminal readiness failure", async () => {
  const { root, bin } = await fakeRuntime({
    curlScript: "#!/usr/bin/env bash\nprintf 'curl: simulated unavailable\\n' >&2\nexit 7\n",
    fakeSleep: true,
  });

  const result = spawnSync(entrypoint, ["bash", "-c", "exit 0"], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /local Codex App Server did not become ready/u);
  assert.equal((result.stderr.match(/curl: simulated unavailable/gu) ?? []).length, 1);
});
