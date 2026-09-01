import { ControlError } from "./errors.js";
import type { GithubRuntime } from "./githubRuntime.js";
import type { ProjectRecord } from "@ade-control-plane/database";
import { GITHUB_WORK_PROFILE_PATH, type GithubRepositoryRef, type GithubSetupClient } from "@ade-control-plane/github";

export interface ProjectOnboardingInput {
  repositoryUrl: string;
  name?: string;
  slug?: string;
}

export interface NormalizedGithubRepository {
  owner: string;
  name: string;
  url: string;
}

export interface ProjectOnboardingPlan {
  repository: NormalizedGithubRepository;
  repositoryId: string;
  defaultBranch: string;
  contentsReadable: boolean;
  adeProfile: "present" | "missing";
  checkout: string;
  initialState: "disabled";
}

export function normalizeGithubRepositoryUrl(value: unknown): NormalizedGithubRepository {
  if (typeof value !== "string" || value.length > 300) throw new ControlError("INVALID_COMMAND", "Enter a valid HTTPS GitHub repository URL.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ControlError("INVALID_COMMAND", "Enter a valid HTTPS GitHub repository URL."); }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.search || url.hash || parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/u.test(parts[0] ?? "") || !/^[A-Za-z0-9_.-]+$/u.test(parts[1] ?? "")) {
    throw new ControlError("INVALID_COMMAND", "Only URLs like https://github.com/owner/repository are accepted.");
  }
  const name = (parts[1] ?? "").replace(/\.git$/iu, "");
  if (!name || name === "." || name === "..") throw new ControlError("INVALID_COMMAND", "The GitHub repository name is invalid.");
  return { owner: parts[0]!, name, url: `https://github.com/${parts[0]}/${name}` };
}

export function deriveProjectSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 63);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(slug)) throw new ControlError("INVALID_COMMAND", "The repository name cannot produce a valid project slug.");
  return slug;
}

export async function buildProjectOnboardingPlan(
  input: ProjectOnboardingInput,
  runtime: GithubRuntime | null,
  projects: readonly ProjectRecord[],
): Promise<ProjectOnboardingPlan> {
  const repository = normalizeGithubRepositoryUrl(input.repositoryUrl);
  const client = asSetupClient(runtime?.client);
  if (!client) throw new ControlError("UNAVAILABLE", "GitHub App access is not configured for the Dashboard.");
  const ref: GithubRepositoryRef = { id: `${repository.owner}/${repository.name}`, owner: repository.owner, name: repository.name };
  let metadata;
  try { metadata = await client.getRepositoryMetadata(ref); } catch { throw new ControlError("UNAVAILABLE", "The GitHub App cannot read this repository."); }
  const duplicate = projects.find((project) => project.repositoryId === metadata.id || (project.repositoryOwner.toLowerCase() === metadata.owner.toLowerCase() && project.repositoryName.toLowerCase() === metadata.name.toLowerCase()));
  if (duplicate) throw new ControlError("CONFLICT", `This repository is already registered as ${duplicate.name}.`);
  if (metadata.owner.toLowerCase() !== repository.owner.toLowerCase() || metadata.name.toLowerCase() !== repository.name.toLowerCase()) throw new ControlError("UNAVAILABLE", "GitHub returned metadata for a different repository.");
  const slug = input.slug?.trim() ? input.slug.trim().toLowerCase() : deriveProjectSlug(repository.name);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(slug) || projects.some((project) => project.slug === slug)) throw new ControlError("CONFLICT", "This project slug is already used or invalid.");
  let profile;
  try { profile = await client.getRepositoryContent(ref, GITHUB_WORK_PROFILE_PATH); } catch { throw new ControlError("UNAVAILABLE", "The GitHub App can read repository metadata but not repository contents."); }
  return { repository: { owner: repository.owner, name: repository.name, url: repository.url }, repositoryId: metadata.id, defaultBranch: metadata.defaultBranch, contentsReadable: true, adeProfile: profile ? "present" : "missing", checkout: slug, initialState: "disabled" };
}

function asSetupClient(client: GithubRuntime["client"]): GithubSetupClient | null {
  const candidate = client as unknown as Partial<GithubSetupClient> | undefined;
  if (!candidate || typeof candidate.getRepositoryMetadata !== "function" || typeof candidate.getRepositoryContent !== "function") return null;
  return candidate as GithubSetupClient;
}
