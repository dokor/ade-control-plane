"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";
import type { ProjectGithubIssueQueueItem } from "../lib/githubIssues.js";
import type { IssueQueueRecommendation } from "../lib/issueQueueRecommendation.js";

interface QueueResponse { items?: readonly ProjectGithubIssueQueueItem[]; }
interface RecommendationResponse extends QueueResponse { recommendation?: IssueQueueRecommendation; }

export function ProjectIssueQueue({ projectId, initialItems }: { projectId: string; initialItems: readonly ProjectGithubIssueQueueItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pendingIssue, setPendingIssue] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const [draggedIssue, setDraggedIssue] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<IssueQueueRecommendation | null>(null);
  const [recommending, setRecommending] = useState(false);
  const enabled = useMemo(() => items.filter(({ runWhenAvailable }) => runWhenAvailable), [items]);
  const stale = items.some(({ projectionState }) => projectionState === "stale");

  async function updateIssue(issueNumber: number, runWhenAvailable: boolean) {
    setPendingIssue(issueNumber); setMessage(null);
    try {
      const body = await requestDashboardJson<QueueResponse>(`/api/projects/${encodeURIComponent(projectId)}/issue-queue`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueNumber, runWhenAvailable }),
      }, "The queue preference could not be saved.");
      if (!Array.isArray(body.items)) throw new Error("The queue preference could not be saved.");
      setItems(body.items); router.refresh();
    } catch (error) { setMessage(dashboardErrorMessage(error, "The queue preference could not be saved.")); }
    finally { setPendingIssue(null); }
  }

  async function reorder(issueNumbers: readonly number[]) {
    if (stale || reordering) return;
    setReordering(true); setMessage(null);
    try {
      const body = await requestDashboardJson<QueueResponse>(`/api/projects/${encodeURIComponent(projectId)}/issue-queue`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueNumbers }),
      }, "The queue order could not be saved.");
      if (!Array.isArray(body.items)) throw new Error("The queue order could not be saved.");
      setItems(body.items); router.refresh();
    } catch (error) { setMessage(dashboardErrorMessage(error, "The queue order could not be saved.")); }
    finally { setReordering(false); }
  }

  async function requestRecommendation() {
    setRecommending(true); setMessage(null);
    try {
      const body = await requestDashboardJson<RecommendationResponse>(`/api/projects/${encodeURIComponent(projectId)}/issue-queue/recommendation`, {}, "The recommendation could not be prepared.");
      if (!body.recommendation) throw new Error("The recommendation could not be prepared.");
      setRecommendation(body.recommendation);
    } catch (error) { setMessage(dashboardErrorMessage(error, "The recommendation could not be prepared.")); }
    finally { setRecommending(false); }
  }

  async function applyRecommendation() {
    if (!recommendation || recommendation.issueNumbers.length === 0) return;
    setRecommending(true); setMessage(null);
    try {
      const body = await requestDashboardJson<RecommendationResponse>(`/api/projects/${encodeURIComponent(projectId)}/issue-queue/recommendation`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueNumbers: recommendation.issueNumbers }),
      }, "The recommended order could not be applied.");
      if (!Array.isArray(body.items)) throw new Error("The recommended order could not be applied.");
      setItems(body.items); setRecommendation(null); router.refresh();
    } catch (error) { setMessage(dashboardErrorMessage(error, "The recommended order could not be applied.")); }
    finally { setRecommending(false); }
  }

  function move(issueNumber: number, direction: -1 | 1) {
    const index = enabled.findIndex(({ number }) => number === issueNumber);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= enabled.length) return;
    const order = enabled.map(({ number }) => number);
    [order[index], order[next]] = [order[next]!, order[index]!];
    void reorder(order);
  }

  function drop(targetIssue: number) {
    if (draggedIssue === null || draggedIssue === targetIssue) return;
    const order = enabled.map(({ number }) => number);
    const from = order.indexOf(draggedIssue); const to = order.indexOf(targetIssue);
    if (from < 0 || to < 0) return;
    order.splice(from, 1); order.splice(to, 0, draggedIssue);
    void reorder(order);
  }

  return <section className="issue-queue panel" aria-labelledby="issue-queue-title">
    <div className="issue-queue-heading">
      <div><p className="task-kicker">GitHub work queue</p><h2 id="issue-queue-title">Choose what ADE may run next</h2><p className="muted">The order is a preference only: readiness, dependencies, quota and safe reconciliation remain authoritative.</p></div>
      <span className="issue-queue-count">{enabled.length} enabled</span>
    </div>
    {stale ? <p className="notice error">GitHub work projection is stale. Queue changes are disabled until the worker reconciles it.</p> : null}
    {message ? <p className="notice error" role="alert">{message}</p> : null}
    <div className="issue-queue-recommendation">
      <div><strong>Guarded recommendation</strong><p className="muted">Uses the live GitHub issue set and ADE's declared readiness and priority. It never changes the queue until you apply it.</p></div>
      <button type="button" className="secondary" onClick={() => void requestRecommendation()} disabled={stale || recommending}>{recommending ? "Preparing…" : "Propose an order"}</button>
    </div>
    {recommendation ? <aside className="issue-queue-proposal" aria-live="polite">
      <p><strong>Proposed order</strong> — {recommendation.summary}</p>
      {recommendation.issueNumbers.length > 0 ? <ol>{recommendation.issueNumbers.map((number) => <li key={number}>#{number} — {recommendation.items.find((item) => item.issueNumber === number)?.reason}</li>)}</ol> : null}
      <details><summary>Why other issues were not included</summary><ul>{recommendation.items.filter((item) => !item.included).map((item) => <li key={item.issueNumber}>#{item.issueNumber} — {item.reason}</li>)}</ul></details>
      <div className="actions"><button type="button" onClick={() => void applyRecommendation()} disabled={recommending || recommendation.issueNumbers.length === 0}>Apply this order</button><button type="button" className="secondary" onClick={() => setRecommendation(null)} disabled={recommending}>Dismiss</button></div>
    </aside> : null}
    <div className="issue-queue-table" role="list" aria-label="GitHub issue queue">
      {items.map((item) => {
        const position = item.runWhenAvailable ? enabled.findIndex(({ number }) => number === item.number) : -1;
        const blocked = item.projectionState === "stale" || !item.runWhenAvailable || item.workState === "running" || item.workState === "completed";
        return <article key={item.number} className={`issue-queue-row ${item.runWhenAvailable ? "enabled" : "held"} ${item.projectionState === "stale" ? "stale" : ""}`} role="listitem"
          draggable={item.runWhenAvailable && !stale && !reordering}
          onDragStart={() => setDraggedIssue(item.number)} onDragEnd={() => setDraggedIssue(null)}
          onDragOver={(event) => { if (item.runWhenAvailable && draggedIssue !== null) event.preventDefault(); }} onDrop={() => drop(item.number)}>
          <div className="issue-queue-order"><span aria-label={item.runWhenAvailable ? `Position ${position + 1}` : "Not queued"}>{item.runWhenAvailable ? position + 1 : "—"}</span>
            <div className="issue-queue-move"><button type="button" onClick={() => move(item.number, -1)} disabled={blocked || position === 0 || reordering} aria-label={`Move issue ${item.number} up`}>↑</button><button type="button" onClick={() => move(item.number, 1)} disabled={blocked || position === enabled.length - 1 || reordering} aria-label={`Move issue ${item.number} down`}>↓</button></div></div>
          <label className="issue-queue-toggle"><input type="checkbox" checked={item.runWhenAvailable} disabled={item.projectionState === "stale" || pendingIssue === item.number} onChange={(event) => void updateIssue(item.number, event.target.checked)} /><span>Run when worker available</span></label>
          <div className="issue-queue-issue"><a href={item.url} target="_blank" rel="noreferrer noopener">#{item.number}</a><strong>{item.title}</strong><p>{item.description}</p></div>
          <div className="issue-queue-pr">{item.pullRequestUrl ? <a href={item.pullRequestUrl} target="_blank" rel="noreferrer noopener">PR #{item.pullRequestNumber} ↗</a> : "No PR"}</div>
          <div className="issue-queue-state"><span className={`badge ${item.projectionState === "stale" ? "stale" : item.workState ?? "neutral"}`}>{item.projectionState === "stale" ? "stale" : item.workState ?? "not queued"}</span></div>
        </article>;
      })}
      {items.length === 0 ? <p className="muted">No open GitHub issue is available for this project.</p> : null}
    </div>
  </section>;
}
