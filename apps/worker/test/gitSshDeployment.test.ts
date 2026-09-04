import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

test("image contains the official GitHub Ed25519 pin and uses the protected Git wrapper", async () => {
  const pin = await readFile(new URL("../../../deploy/ssh/github_known_hosts", import.meta.url), "utf8");
  const entries = pin.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  assert.equal(entries.length, 1);
  const [host, algorithm, key] = entries[0]!.split(" ");
  assert.equal(host, "github.com"); assert.equal(algorithm, "ssh-ed25519");
  assert.equal(createHash("sha256").update(Buffer.from(key!, "base64")).digest("base64").replace(/=+$/, ""), "+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU");
  const compose = await readFile(new URL("../../../compose.yaml", import.meta.url), "utf8");
  assert.match(compose, /GIT_SSH: \/usr\/local\/bin\/ade-git-ssh/);
  assert.doesNotMatch(compose, /StrictHostKeyChecking=no/);
});

test("OpenSSH resolves strict pinned trust and mounted identities even with an insecure old config", { skip: process.platform === "win32" }, async () => {
  const home = await mkdtemp(join(tmpdir(), "ade-ssh-test-"));
  try {
    await mkdir(join(home, ".ssh"), { mode: 0o700 });
    await writeFile(join(home, ".ssh", "config"), "Host *\n  StrictHostKeyChecking no\n  UserKnownHostsFile /tmp/wrong-hosts\n", { mode: 0o600 });
    await writeFile(join(home, ".ssh", "id_ed25519"), "test-only-not-a-key", { mode: 0o600 });
    const { stdout } = await promisify(execFile)("bash", [fileURLToPath(new URL("../../../deploy/bin/git-ssh", import.meta.url)), "-G", "git@github.com"], { env: { PATH: process.env.PATH!, HOME: home } });
    assert.match(stdout, /stricthostkeychecking true/);
    assert.match(stdout, /globalknownhostsfile \/etc\/ssh\/ade_github_known_hosts/);
    assert.match(stdout, /userknownhostsfile \/dev\/null/);
    assert.match(stdout, /batchmode yes/);
    assert.match(stdout, /hostkeyalgorithms ssh-ed25519/);
    assert.ok(stdout.includes(`identityfile ${home}/.ssh/id_ed25519`));
  } finally { await rm(home, { recursive: true, force: true }); }
});
