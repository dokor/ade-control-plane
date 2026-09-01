import { Buffer } from "node:buffer";

import type { ProjectRecord } from "@ade-control-plane/database";
import {
  GITHUB_WORK_PROFILE_PATH,
  GITHUB_WORK_PROFILE_VERSION,
  type GithubLabel,
  type GithubRepositoryRef,
  type GithubSetupClient,
} from "@ade-control-plane/github";

import type { GithubRuntime } from "./githubRuntime.js";

export type SetupRequirementState = "ready" | "missing" | "invalid" | "optional";

export interface ProjectSetupRequirement {
  key: string;
  label: string;
  state: SetupRequirementState;
  detail: string;
  repairable: boolean;
  source: "repository" | "github" | "runtime";
}

export interface ProjectSetupReadiness {
  ready: boolean;
  requirements: readonly ProjectSetupRequirement[];
  missingLabels: readonly GithubLabel[];
  missingFiles: readonly string[];
  plannedFiles: readonly string[];
  invalidFiles: readonly string[];
  checkedAt: string;
}

export interface SetupMutationResult {
  labelsCreated: readonly string[];
  pullRequestUrl: string | null;
  pullRequestNumber: number | null;
  skipped: readonly string[];
  readiness: ProjectSetupReadiness;
}

const REQUIRED_LABELS: readonly GithubLabel[] = [
  { name: "ready-for-dev", color: "0e8a16", description: "ADE issue is ready for development" },
  { name: "waiting-human", color: "fbca04", description: "ADE issue is waiting for a human decision" },
  { name: "blocked", color: "b60205", description: "ADE issue is blocked" },
];

const SETUP_PATHS = {
  instructions: "AGENTS.md",
  alternativeInstructions: "CLAUDE.md",
  issueTemplate: ".github/ISSUE_TEMPLATE/ade-work.yml",
  context: ".ade/context.md",
} as const;

export async function inspectProjectSetup(
  project: ProjectRecord,
  runtime: GithubRuntime | null,
  now = new Date().toISOString(),
): Promise<ProjectSetupReadiness> {
  const setupClient = asSetupClient(runtime?.client);
  const requirements: ProjectSetupRequirement[] = [];
  const missingLabels: GithubLabel[] = [];
  const missingFiles: string[] = [];
  const plannedFiles: string[] = [];
  const invalidFiles: string[] = [];

  if (!setupClient) {
    requirements.push({ key: "repository-access", label: "Repository accessible", state: "missing", detail: "Configure the GitHub App installation and repository contents access.", repairable: false, source: "runtime" });
    requirements.push({ key: "github-app", label: "GitHub App access", state: "missing", detail: "The Dashboard has no repository-scoped GitHub App client.", repairable: false, source: "runtime" });
    return { ready: false, requirements, missingLabels, missingFiles, plannedFiles, invalidFiles, checkedAt: now };
  }

  const repository = repositoryRef(project);
  const inspected = await Promise.all([
    readProfile(repository, setupClient),
    setupClient.listLabels(repository),
    Promise.all(Object.values(SETUP_PATHS).map(async (path) => [path, await setupClient.getRepositoryContent(repository, path)] as const)),
  ]).catch(() => null);
  if (!inspected) {
    requirements.push({ key: "repository-access", label: "Repository accessible", state: "invalid", detail: "GitHub rejected or could not complete the repository setup checks.", repairable: false, source: "repository" });
    requirements.push({ key: "github-app", label: "GitHub App access", state: "invalid", detail: "Check the App installation and repository contents/metadata permissions.", repairable: false, source: "runtime" });
    return { ready: false, requirements, missingLabels, missingFiles, plannedFiles, invalidFiles, checkedAt: now };
  }
  const [profile, labels, files] = inspected;
  const fileMap = new Map(files);
  if (profile.state === "missing") missingFiles.push(GITHUB_WORK_PROFILE_PATH);
  if (profile.state === "invalid") invalidFiles.push(GITHUB_WORK_PROFILE_PATH);
  requirements.push({ key: "repository-access", label: "Repository accessible", state: "ready", detail: "Repository contents and labels can be read.", repairable: false, source: "repository" });
  requirements.push(profile.requirement);
  requirements.push({ key: "runtime", label: "ADE runtime compatible", state: "ready", detail: `Using the shared ADE contract ${GITHUB_WORK_PROFILE_VERSION}.`, repairable: false, source: "runtime" });
  requirements.push({ key: "profiles", label: "Profiles and rules available", state: profile.valid ? "ready" : profile.state === "missing" ? "missing" : "invalid", detail: profile.valid ? "The repository profile declares the supported work capability." : "Profiles and rules cannot be resolved until the ADE profile is valid.", repairable: profile.state === "missing", source: "repository" });

  const hasInstructions = Boolean(fileMap.get(SETUP_PATHS.instructions) ?? fileMap.get(SETUP_PATHS.alternativeInstructions));
  if (!hasInstructions) {
    missingFiles.push(SETUP_PATHS.instructions);
    requirements.push({ key: "instructions", label: "Project instructions", state: "missing", detail: "Add AGENTS.md or CLAUDE.md so the selected agent has repository guidance.", repairable: true, source: "repository" });
  } else {
    requirements.push({ key: "instructions", label: "Project instructions", state: "ready", detail: "Agent instructions are present.", repairable: false, source: "repository" });
  }
  const context = fileMap.get(SETUP_PATHS.context);
  requirements.push({ key: "context", label: "Project context", state: context ? "ready" : "optional", detail: context ? "An ADE context note is present." : "Optional: add .ade/context.md for project-specific context.", repairable: Boolean(!context), source: "repository" });
  const issueTemplate = fileMap.get(SETUP_PATHS.issueTemplate);
  requirements.push({ key: "issue-template", label: "ADE issue template", state: issueTemplate ? "ready" : "optional", detail: issueTemplate ? "The supported ADE issue template is present." : "Optional: provide the ADE issue template for consistent issue metadata.", repairable: true, source: "github" });
  plannedFiles.push(...missingFiles);
  if (!issueTemplate) plannedFiles.push(SETUP_PATHS.issueTemplate);

  const existingLabels = new Set(labels.map(({ name }) => name));
  for (const label of REQUIRED_LABELS) if (!existingLabels.has(label.name)) missingLabels.push(label);
  requirements.push({
    key: "github-labels",
    label: "GitHub workflow labels",
    state: missingLabels.length === 0 ? "ready" : "missing",
    detail: missingLabels.length === 0 ? "All supported ADE workflow labels are present." : `Missing: ${missingLabels.map(({ name }) => name).join(", ")}.`,
    repairable: missingLabels.length > 0,
    source: "github",
  });
  requirements.push({ key: "github-app", label: "GitHub App access", state: "ready", detail: "The configured App can read repository setup data.", repairable: false, source: "runtime" });

  const mandatory = requirements.filter((requirement) => requirement.key !== "context" && requirement.key !== "issue-template");
  return { ready: mandatory.every(({ state }) => state === "ready"), requirements, missingLabels, missingFiles, plannedFiles: [...new Set(plannedFiles)], invalidFiles, checkedAt: now };
}

export async function prepareProjectSetup(
  project: ProjectRecord,
  runtime: GithubRuntime | null,
  now = new Date().toISOString(),
): Promise<SetupMutationResult> {
  const setupClient = asSetupClient(runtime?.client);
  if (!setupClient) throw new Error("GitHub setup is unavailable.");
  const before = await inspectProjectSetup(project, runtime, now);
  const repository = repositoryRef(project);
  const labelsCreated: string[] = [];
  for (const label of before.missingLabels) {
    await setupClient.createLabel(repository, label);
    labelsCreated.push(label.name);
  }

  const files: Record<string, string> = {};
  if (before.missingFiles.includes(GITHUB_WORK_PROFILE_PATH)) {
    files[GITHUB_WORK_PROFILE_PATH] = `${JSON.stringify({ version: GITHUB_WORK_PROFILE_VERSION, capabilities: ["github-work-items"], skillPaths: [".agents/skills"] }, null, 2)}\n`;
  }
  if (before.missingFiles.includes(SETUP_PATHS.instructions)) {
    files[SETUP_PATHS.instructions] = "# Agent instructions\n\nUse the repository's existing documentation and tests. Keep changes focused on the requested ADE issue and leave generated changes reviewable in a pull request.\n";
  }
  if (before.requirements.some(({ key, state }) => key === "issue-template" && state === "optional")) {
    files[SETUP_PATHS.issueTemplate] = "name: ADE work\ndescription: Create an issue that can be scheduled by ADE\nbody:\n  - type: markdown\n    attributes:\n      value: |\n        Describe the desired change and its acceptance criteria.\n";
  }

  let pullRequestUrl: string | null = null;
  let pullRequestNumber: number | null = null;
  if (Object.keys(files).length > 0) {
    const pullRequest = await setupClient.findOpenSetupPullRequest(repository, "chore(ade): prepare project setup") ?? await setupClient.createSetupPullRequest(repository, {
      files,
      title: "chore(ade): prepare project setup",
      body: `## ADE project setup\n\nThis PR adds only missing ADE setup files detected by Control Plane:\n\n${Object.keys(files).map((path) => `- \`${path}\``).join("\n")}\n\nExisting files were preserved. Review and merge this PR, then Control Plane will re-check readiness.`,
    });
    pullRequestUrl = pullRequest.url;
    pullRequestNumber = pullRequest.number;
  }
  const readiness = await inspectProjectSetup(project, runtime, new Date().toISOString());
  return { labelsCreated, pullRequestUrl, pullRequestNumber, skipped: before.invalidFiles, readiness };
}

export function requiredGithubSetupLabels(): readonly GithubLabel[] {
  return REQUIRED_LABELS;
}

function repositoryRef(project: ProjectRecord): GithubRepositoryRef {
  return { id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`, owner: project.repositoryOwner, name: project.repositoryName };
}

async function readProfile(
  repository: GithubRepositoryRef,
  setupClient: GithubSetupClient,
): Promise<{ valid: boolean; state: "ready" | "missing" | "invalid"; requirement: ProjectSetupRequirement }> {
  const content = await setupClient.getRepositoryContent(repository, GITHUB_WORK_PROFILE_PATH);
  if (!content) return { valid: false, state: "missing", requirement: { key: "ade-config", label: "ADE configuration", state: "missing", detail: `${GITHUB_WORK_PROFILE_PATH} is missing.`, repairable: true, source: "repository" } };
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8")); } catch { parsed = null; }
  const valid = isRecord(parsed) && parsed.version === GITHUB_WORK_PROFILE_VERSION && isStringArray(parsed.capabilities) && isStringArray(parsed.skillPaths);
  if (!valid) return { valid: false, state: "invalid", requirement: { key: "ade-config", label: "ADE configuration", state: "invalid", detail: `${GITHUB_WORK_PROFILE_PATH} exists but is not a valid ${GITHUB_WORK_PROFILE_VERSION} profile.`, repairable: false, source: "repository" } };
  return { valid: true, state: "ready", requirement: { key: "ade-config", label: "ADE configuration", state: "ready", detail: `${GITHUB_WORK_PROFILE_PATH} is valid.`, repairable: false, source: "repository" } };
}

function asSetupClient(client: GithubRuntime["client"]): GithubSetupClient | null {
  const candidate = client as unknown as Partial<GithubSetupClient> | undefined;
  if (!candidate || typeof candidate.getRepositoryContent !== "function" || typeof candidate.listLabels !== "function" || typeof candidate.createLabel !== "function" || typeof candidate.findOpenSetupPullRequest !== "function" || typeof candidate.createSetupPullRequest !== "function") return null;
  return candidate as GithubSetupClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
