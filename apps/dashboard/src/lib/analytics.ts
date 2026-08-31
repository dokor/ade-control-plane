import type { AgentUsageRecord } from "@ade-control-plane/database";

export interface UsageSummary {
  executions: number;
  completedExecutions: number;
  wallDurationMs: number;
  providerDurationMs: number | null;
  totalTokens: number | null;
  costs: Readonly<Record<string, number>>;
  providers: Readonly<Record<string, number>>;
}

export interface IssueUsageSummary extends UsageSummary {
  issueNumber: number | null;
  projectId: string;
  attempts: number;
  pullRequestNumbers: readonly number[];
}

export function summarizeUsage(records: readonly AgentUsageRecord[]): UsageSummary {
  const totalTokens = sumKnown(records.map((record) => record.totalTokens));
  const providerDurations = sumKnown(records.map((record) => record.providerDurationMs));
  const costs: Record<string, number> = {};
  const providers: Record<string, number> = {};
  for (const record of records) {
    providers[record.provider] = (providers[record.provider] ?? 0) + 1;
    if (record.costAmount !== undefined) {
      const key = `${record.costKind ?? "unknown"}:${record.costCurrency ?? "unknown"}`;
      costs[key] = (costs[key] ?? 0) + record.costAmount;
    }
  }
  return {
    executions: records.length,
    completedExecutions: records.filter((record) => record.finishedAt !== null).length,
    wallDurationMs: records.reduce((total, record) => total + (record.wallDurationMs ?? 0), 0),
    providerDurationMs: providerDurations,
    totalTokens,
    costs,
    providers,
  };
}

export function groupUsageByIssue(records: readonly AgentUsageRecord[]): readonly IssueUsageSummary[] {
  const groups = new Map<string, AgentUsageRecord[]>();
  for (const record of records) {
    const key = `${record.projectId}:${record.githubIssueNumber ?? "task"}`;
    const current = groups.get(key) ?? [];
    current.push(record);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((group) => ({
      ...summarizeUsage(group),
      issueNumber: group[0]?.githubIssueNumber ?? null,
      projectId: group[0]?.projectId ?? "",
      attempts: group.length,
      pullRequestNumbers: [...new Set(group.flatMap((record) => record.githubPullRequestNumber === null ? [] : [record.githubPullRequestNumber]))],
    }))
    .sort((left, right) => right.wallDurationMs - left.wallDurationMs);
}

function sumKnown(values: readonly (number | undefined)[]): number | null {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}
