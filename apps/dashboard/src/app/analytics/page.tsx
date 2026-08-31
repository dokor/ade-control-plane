import Link from "next/link";

import { Shell } from "../../components/Shell.js";
import { requireAuthenticatedContext } from "../../lib/auth.js";
import { groupUsageByIssue, summarizeUsage } from "../../lib/analytics.js";
import { formatInstant } from "../../lib/format.js";
import { getPersistence } from "../../lib/persistence.js";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; provider?: string; days?: string }>;
}) {
  const { session, config } = await requireAuthenticatedContext("/analytics");
  const filters = await searchParams;
  const projectId = safeFilter(filters.projectId);
  const provider = safeFilter(filters.provider);
  const days = filters.days === "7" ? 7 : 30;
  const persistence = await getPersistence();
  const projects = await persistence.projects.list();
  const records = await persistence.agentUsage?.list({
    ...(projectId ? { projectId } : {}),
    ...(provider ? { provider } : {}),
    from: new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString(),
    limit: 5000,
  }) ?? [];
  const summary = summarizeUsage(records);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const issueSummaries = groupUsageByIssue(records);
  const projectSummaries = [...new Set(records.map((record) => record.projectId))]
    .map((id) => ({ id, name: projectNames.get(id) ?? id, summary: summarizeUsage(records.filter((record) => record.projectId === id)) }))
    .sort((left, right) => right.summary.wallDurationMs - left.summary.wallDurationMs);

  return (
    <Shell title="Analytics" actorRef={session.actorRef} refreshIntervalMs={config.refreshIntervalMs}>
      <p className="muted">Last {days} days · usage metrics only, no prompts or provider payloads.</p>
      <form className="panel actions" method="get">
        <label>Project <select name="projectId" defaultValue={projectId ?? ""}>
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <label>Provider <select name="provider" defaultValue={provider ?? ""}>
          <option value="">All providers</option>
          <option value="codex">Codex</option>
          <option value="claude-code">Claude Code</option>
        </select></label>
        <label>Period <select name="days" defaultValue={String(days)}><option value="7">7 days</option><option value="30">30 days</option></select></label>
        <button type="submit">Apply</button>
      </form>

      <section className="cards">
        <article className="card"><h2>Executions</h2><p className="value">{summary.executions}</p><p className="detail">{summary.completedExecutions} with a terminal timestamp</p><p className="detail">{formatProviders(summary.providers)}</p></article>
        <article className="card"><h2>Wall time</h2><p className="value">{formatDuration(summary.wallDurationMs)}</p><p className="detail">Provider time {formatDuration(summary.providerDurationMs)}</p></article>
        <article className="card"><h2>Tokens</h2><p className="value">{formatNumber(summary.totalTokens)}</p><p className="detail">Unknown remains unknown when the provider reports no total.</p></article>
        <article className="card"><h2>Cost</h2><p className="value">{formatCosts(summary.costs)}</p><p className="detail">Grouped by explicit cost provenance; subscription usage is not fabricated as €.</p></article>
      </section>

      <section><h2>By issue / attempt</h2>
        {issueSummaries.length === 0 ? <p className="muted">No usage recorded yet.</p> : <div className="list">{issueSummaries.map((item) => (
          <article className="panel" key={`${item.projectId}:${item.issueNumber ?? "task"}`}>
            <div className="row"><strong>{item.issueNumber === null ? "Prompt task" : `GitHub issue #${item.issueNumber}`}</strong><span>{projectNames.get(item.projectId) ?? item.projectId}</span></div>
            <p className="detail">{item.attempts} attempt(s) · wall {formatDuration(item.wallDurationMs)} · tokens {formatNumber(item.totalTokens)} · providers {formatProviders(item.providers)} · {formatCosts(item.costs)}{item.pullRequestNumbers.length > 0 ? ` · PR ${item.pullRequestNumbers.map((number) => `#${number}`).join(", ")}` : ""}</p>
          </article>
        ))}</div>}
      </section>

      <section><h2>By project</h2>
        {projectSummaries.length === 0 ? <p className="muted">No project usage recorded yet.</p> : <div className="list">{projectSummaries.map((item) => (
          <article className="panel" key={item.id}><div className="row"><strong><Link href={`/projects/${item.id}`}>{item.name}</Link></strong><span>{item.summary.executions} executions</span></div><p className="detail">Wall {formatDuration(item.summary.wallDurationMs)} · provider time {formatDuration(item.summary.providerDurationMs)} · tokens {formatNumber(item.summary.totalTokens)} · {formatCosts(item.summary.costs)}</p></article>
        ))}</div>}
      </section>
      <p className="muted">Generated {formatInstant(new Date().toISOString())}</p>
    </Shell>
  );
}

function safeFilter(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length <= 200 && /^[a-zA-Z0-9._:-]+$/u.test(value) ? value : undefined;
}

function formatNumber(value: number | null): string { return value === null ? "unknown" : value.toLocaleString("en-US"); }

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "unknown";
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatCosts(costs: Readonly<Record<string, number>>): string {
  const entries = Object.entries(costs);
  return entries.length === 0 ? "cost unknown" : entries.map(([key, amount]) => `${amount.toFixed(2)} ${key.split(":")[1] ?? ""} (${key.split(":")[0]})`).join(" · ");
}

function formatProviders(providers: Readonly<Record<string, number>>): string {
  const entries = Object.entries(providers);
  return entries.length === 0 ? "unknown" : entries.map(([provider, count]) => `${provider} ×${count}`).join(", ");
}
