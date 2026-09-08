import type { ProjectGithubIssueQueueItem } from "./githubIssues.js";

export interface IssueQueueRecommendation {
  issueNumbers: readonly number[];
  items: readonly {
    issueNumber: number;
    included: boolean;
    reason: string;
  }[];
  summary: string;
}

/**
 * A deliberately conservative recommendation from live GitHub display data
 * and ADE's validated work projection. It is not a scheduling authority: it
 * can only be applied explicitly, and the scheduler independently repeats all
 * readiness, dependency, quota and reconciliation gates.
 */
export function recommendIssueQueue(
  items: readonly ProjectGithubIssueQueueItem[],
): IssueQueueRecommendation {
  const explanations = items.map((item) => {
    if (item.projectionState === "stale") return { issueNumber: item.number, included: false, reason: "ADE work projection is stale; reconcile before considering this issue." };
    if (item.workState !== "ready") {
      return {
        issueNumber: item.number,
        included: false,
        reason: item.workState
          ? `ADE reports this issue as ${item.workState}; it is not eligible for automatic execution.`
          : "This issue has not yet been admitted and confirmed ready by ADE.",
      };
    }
    return {
      issueNumber: item.number,
      included: true,
      reason: `ADE marked it ready with declared priority ${item.priority ?? 0}; dependencies have already passed the ADE readiness gate.`,
    };
  });
  const included = items
    .filter((item) => item.projectionState === "current" && item.workState === "ready")
    .toSorted((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || Date.parse(left.updatedAt) - Date.parse(right.updatedAt) || left.number - right.number)
    .map(({ number }) => number);
  return {
    issueNumbers: included,
    items: explanations,
    summary: included.length
      ? `${included.length} ADE-ready issue${included.length === 1 ? "" : "s"} can be ordered safely. The proposal is not active until you apply it.`
      : "No issue is currently safe to add to an automatic queue. Manual queue settings remain unchanged.",
  };
}
