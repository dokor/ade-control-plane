import type { GithubWorkState } from "./workAdapter.js";

/** Labels owned exclusively by ADE Control Plane. Human/project labels survive untouched. */
export const ADE_WORKFLOW_LABELS = [
  "backlog-refined",
  "ready-for-dev",
  "in-progress",
  "waiting-human",
  "blocked",
  "pr-ready",
] as const;

export type AdeWorkflowLabel = (typeof ADE_WORKFLOW_LABELS)[number];

export function labelsForGithubWorkState(
  state: GithubWorkState,
  pullRequestNumber: number | null,
): readonly AdeWorkflowLabel[] {
  switch (state) {
    case "ready": return ["backlog-refined", "ready-for-dev"];
    case "running": return ["in-progress"];
    case "waiting-human": return pullRequestNumber === null ? ["waiting-human"] : ["waiting-human", "pr-ready"];
    case "blocked":
    case "failed": return ["blocked"];
    case "completed": return ["backlog-refined"];
  }
}

/** Replaces only ADE-owned labels, preserving every label a repository owns. */
export function mergeAdeWorkflowLabels(
  existing: readonly string[],
  desired: readonly string[],
): readonly string[] {
  const owned = new Set<string>(ADE_WORKFLOW_LABELS);
  return [...new Set([...existing.filter((label) => !owned.has(label)), ...desired])].toSorted();
}
