import assert from "node:assert/strict";
import test from "node:test";
import { removeGithubWork, REMOVE_GITHUB_WORK_CONFIRMATION } from "../src/lib/githubWorkRemoval.js";
import { admitGithubIssue } from "../src/lib/githubIssueAdmission.js";
import { readGithubWorkMetadata, upsertGithubWorkMetadata, DEFAULT_GITHUB_WORK_METADATA, type GithubIssueLifecycleClient } from "@ade-control-plane/github";
import { project } from "./helpers/fixtures.js";

const input = { projectId: project().id, issueNumber: 165, workId: "11111111-1111-4111-8111-111111111111", confirmed: true };
const identity = { actorRef: "operator:test", canRead: true, canMutate: true };

test("requires mutation rights and explicit confirmation without invoking persistence", async () => {
  const repository = { remove: async () => { throw new Error("must not be called"); } };
  await assert.rejects(removeGithubWork(repository, null, input), /UNAUTHENTICATED/);
  await assert.rejects(removeGithubWork(repository, { ...identity, canMutate: false }, input), /FORBIDDEN/);
  await assert.rejects(removeGithubWork(repository, identity, { ...input, confirmed: false }), /INVALID_COMMAND/);
  await assert.rejects(removeGithubWork(repository, identity, { ...input, issueNumber: -1 }), /INVALID_COMMAND/);
  assert.match(REMOVE_GITHUB_WORK_CONFIRMATION, /GitHub issue, branches and pull requests will NOT be deleted/);
  assert.match(REMOVE_GITHUB_WORK_CONFIRMATION, /cancelled\/reconciled first/);
});

test("uses selected work identity and maps idempotency and safe rejections", async () => {
  for (const result of ["removed", "already-removed"] as const) {
    const answer = await removeGithubWork({ remove: async (request) => {
      assert.equal(request.workId, input.workId); assert.equal(request.actorRef, identity.actorRef); return result;
    } }, identity, input);
    assert.equal(answer.removed, true);
    assert.equal(answer.alreadyRemoved, result === "already-removed");
  }
  for (const result of ["active", "ambiguous", "not-found"] as const) await assert.rejects(removeGithubWork({ remove: async () => result }, identity, input), result === "not-found" ? /NOT_FOUND/ : /CONFLICT/);
});

test("explicit readmission resets only lifecycle metadata, preserving issue prose and dependencies", async () => {
  const old = upsertGithubWorkMetadata("Keep the original issue text", { ...DEFAULT_GITHUB_WORK_METADATA, state: "failed", priority: 90, dependsOn: [42], executionRef: "old-execution", branchName: "ade/old", pullRequestNumber: 7 });
  let updated = "";
  const client = { getIssueDetails: async () => ({ number: 165, state: "open", body: old }),
    updateIssueBody: async (_repo: unknown, _number: number, body: string) => { updated = body; } } as unknown as GithubIssueLifecycleClient;
  await admitGithubIssue(project(), client, 165, true);
  assert.match(updated, /Keep the original issue text/);
  const metadata = readGithubWorkMetadata(updated);
  assert.equal(metadata?.state, "ready"); assert.equal(metadata?.priority, 90); assert.deepEqual(metadata?.dependsOn, [42]);
  assert.equal(metadata?.executionRef, null); assert.equal(metadata?.branchName, null); assert.equal(metadata?.pullRequestNumber, null);
});
