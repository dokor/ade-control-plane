import assert from "node:assert/strict";
import test from "node:test";

import { readGithubWorkMetadata, type GithubIssueLifecycleClient } from "@ade-control-plane/github";

import { admitGithubIssue } from "../src/lib/githubIssueAdmission.js";
import { NOW, project } from "./helpers/fixtures.js";

test("admits an ordinary issue as queued and synchronizes only the refined label", async () => {
  let writtenBody = "";
  let synchronizedLabels: readonly string[] = [];
  const client: GithubIssueLifecycleClient = {
    getIssueDetails: async () => ({
      number: 246,
      title: "Needs ADE preparation",
      state: "open",
      url: "https://github.com/dokor/argos/issues/246",
      updatedAt: NOW,
      body: "## Objective\nPrepare the issue through ADE.",
      labels: ["bug"],
    }),
    updateIssueBody: async (_repository, issueNumber, body) => {
      writtenBody = body;
      return {
        number: issueNumber,
        title: "Needs ADE preparation",
        state: "open",
        url: `https://github.com/dokor/argos/issues/${issueNumber}`,
        updatedAt: NOW,
        body,
        labels: ["bug"],
      };
    },
    syncAdeWorkflowLabels: async (_repository, issueNumber, labels) => {
      synchronizedLabels = labels;
      return {
        number: issueNumber,
        title: "Needs ADE preparation",
        state: "open",
        url: `https://github.com/dokor/argos/issues/${issueNumber}`,
        updatedAt: NOW,
        body: writtenBody,
        labels: ["bug", ...labels],
      };
    },
  };

  const result = await admitGithubIssue(project(), client, 246);

  assert.equal(result.stage, "Queued for ADE");
  assert.deepEqual(synchronizedLabels, ["backlog-refined"]);
  assert.equal(readGithubWorkMetadata(writtenBody)?.state, "ready");
});
