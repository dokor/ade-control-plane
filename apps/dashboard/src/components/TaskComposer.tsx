"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState, type FormEvent } from "react";

import type { TaskGithubIssue } from "../lib/githubIssues.js";
import type { TaskProjectOption } from "../lib/taskReadModel.js";

interface TaskResponse {
  task?: { id: string };
  code?: string;
  summary?: string;
  correlationId?: string;
}

export function TaskComposer({
  projects,
  activeTaskId,
}: {
  projects: readonly TaskProjectOption[];
  activeTaskId: string | null;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [sourceType, setSourceType] = useState<"github-issue" | "prompt">("github-issue");
  const [issues, setIssues] = useState<readonly TaskGithubIssue[]>([]);
  const [issueNumber, setIssueNumber] = useState<number | "">("");
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedIssue = issues.find((issue) => issue.number === issueNumber) ?? null;
  const disabled = pending || activeTaskId !== null || !projectId ||
    (sourceType === "github-issue" ? selectedIssue === null : !prompt.trim());

  useEffect(() => {
    if (sourceType !== "github-issue" || !projectId) return;
    const controller = new AbortController();
    setIssuesLoading(true);
    setIssuesError(null);
    setIssues([]);
    setIssueNumber("");
    fetch(`/api/github/issues?projectId=${encodeURIComponent(projectId)}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          issues?: readonly TaskGithubIssue[];
          summary?: string;
        };
        if (!response.ok || !Array.isArray(body.issues)) {
          throw new Error(body.summary ?? "GitHub issues could not be loaded.");
        }
        setIssues(body.issues);
        setIssueNumber(body.issues[0]?.number ?? "");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setIssuesError(error instanceof Error ? error.message : "GitHub issues could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIssuesLoading(false);
      });
    return () => controller.abort();
  }, [projectId, sourceType]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          projectId,
          source: sourceType === "github-issue"
            ? { type: "github-issue", issueNumber: issueNumber as number }
            : { type: "prompt", prompt },
        }),
      });
      const body = (await response.json()) as TaskResponse;
      if (!response.ok || !body.task?.id) {
        setError(
          `${body.code ?? "ERROR"}: ${body.summary ?? "The task could not be created."}`,
        );
        return;
      }
      const taskId = body.task.id;
      setPrompt("");
      startTransition(() => router.push(`/tasks/${taskId}`));
    } catch {
      setError("The Dashboard could not reach the task API.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="task-composer" onSubmit={submit}>
      <div className="field-group">
        <label htmlFor="task-project">Project</label>
        <select
          id="task-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          disabled={pending || activeTaskId !== null}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} - {project.repository}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field-group task-source-options" disabled={pending || activeTaskId !== null}>
        <legend>Source</legend>
        <label>
          <input
            type="radio"
            name="task-source"
            checked={sourceType === "github-issue"}
            onChange={() => setSourceType("github-issue")}
          />
          GitHub issue
        </label>
        <label>
          <input
            type="radio"
            name="task-source"
            checked={sourceType === "prompt"}
            onChange={() => setSourceType("prompt")}
          />
          Prompt libre
        </label>
      </fieldset>

      {sourceType === "github-issue" ? (
        <div className="field-group">
          <label htmlFor="task-issue">Issue</label>
          <select
            id="task-issue"
            value={issueNumber}
            onChange={(event) => setIssueNumber(event.target.value ? Number(event.target.value) : "")}
            disabled={pending || activeTaskId !== null || issuesLoading || issues.length === 0}
          >
            {issues.length === 0 ? (
              <option value="">{issuesLoading ? "Loading issues..." : "No ready issue available"}</option>
            ) : null}
            {issues.map((issue) => (
              <option key={issue.number} value={issue.number}>
                #{issue.number} - {issue.title}
              </option>
            ))}
          </select>
          {selectedIssue ? (
            <small className="task-issue-meta">
              ADE managed · {selectedIssue.adeState} · priority {selectedIssue.priority} ·{" "}
              <a href={selectedIssue.url} target="_blank" rel="noreferrer noopener">View on GitHub ↗</a>
            </small>
          ) : null}
          {issuesError ? <p className="task-inline-note error">{issuesError}</p> : null}
        </div>
      ) : (
        <div className="field-group">
          <div className="field-heading">
            <label htmlFor="task-prompt">What should Codex deliver?</label>
            <span>{prompt.length.toLocaleString()} / 20,000</span>
          </div>
          <textarea
            id="task-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={20_000}
            rows={8}
            placeholder="Describe one focused change, its expected behavior, and the checks that matter."
            disabled={pending || activeTaskId !== null}
            required
          />
        </div>
      )}

      {activeTaskId ? (
        <p className="task-inline-note">
          One task is already active. <Link href={`/tasks/${activeTaskId}`}>Open it</Link>
          {" "}before starting another.
        </p>
      ) : null}
      {projects.length === 0 ? (
        <p className="task-inline-note">No enabled project is available.</p>
      ) : null}
      {error ? <p className="notice error" role="alert">{error}</p> : null}

      <button type="submit" className="task-run" disabled={disabled}>
        <span>{pending ? "Submitting" : sourceType === "github-issue" ? "Run issue" : "Run task"}</span>
        <span aria-hidden="true">-&gt;</span>
      </button>
    </form>
  );
}
