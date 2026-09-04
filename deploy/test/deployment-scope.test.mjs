import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const script = fileURLToPath(new URL("../bin/deployment-scope", import.meta.url)).replaceAll("\\", "/");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

test("scope, migration detection and content keys track actual runtime inputs conservatively", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ade-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const run = (...args) => execFileSync(bash, ["-c", 'export PATH=/usr/bin:/mingw64/bin:$PATH; bash "$@"', "scope-test", script, ...args], { cwd: root, env, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("commit", "--allow-empty", "-m", "initial");
  assert.equal(run("scope", "HEAD", "HEAD"), "none");
  assert.equal(run("scope", "missing", "HEAD"), "full");
  assert.equal(run("migrations", "missing", "HEAD"), "true");
  for (const [file, expected, migration] of [
    ["docs/guide.md", "none", false], ["apps/dashboard/src/page.tsx", "dashboard", false],
    ["apps/worker/src/main.ts", "worker", false], ["packages/ade-client/src/index.ts", "worker", false],
    ["packages/host-runner/src/index.ts", "worker", false], ["packages/runner-protocol/src/index.ts", "worker", false],
    ["packages/github/src/index.ts", "full", false], ["packages/database/migrations/next.sql", "full", true],
    ["apps/worker/src/v0/migrate.ts", "worker", true], ["pnpm-lock.yaml", "full", false],
    ["unknown/new.config", "full", false],
  ]) {
    const before = git("rev-parse", "HEAD");
    const keys = [run("key", "dashboard", "HEAD"), run("key", "worker", "HEAD")];
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), "change\n");
    git("add", file); git("commit", "-m", "change");
    assert.equal(run("scope", before, "HEAD"), expected, file);
    assert.equal(run("migrations", before, "HEAD"), String(migration), file);
    for (const [index, runtime] of ["dashboard", "worker"].entries()) {
      assert.equal(run("key", runtime, "HEAD") === keys[index], expected !== "full" && expected !== runtime, `${file}: ${runtime}`);
    }
  }
});

test("prebuilt deployment keeps migration ordering, digest checks and manual-only fallback", async () => {
  const deploy = await readFile(new URL("../bin/deploy", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const build = await readFile(new URL("../../.github/workflows/build-image.yml", import.meta.url), "utf8");
  assert.match(deploy, /@sha256:/);
  assert.match(deploy, /org\.ade\.source-key/);
  assert.match(deploy, /--local/);
  assert.ok(deploy.indexOf('if "$local_build"') < deploy.indexOf('build "${services[@]}"'));
  assert.ok(deploy.indexOf("database migration failed") < deploy.indexOf('up -d --no-build --no-deps'));
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /--local/);
  assert.match(build, /ubuntu-24.04-arm/);
  assert.doesNotMatch(build, /setup-qemu/);
  assert.match(build, /cache-to: type=gha/);
});
