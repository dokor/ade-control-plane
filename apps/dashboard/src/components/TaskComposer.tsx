"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useState, type FormEvent } from "react";

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
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || activeTaskId !== null || !projectId || !prompt.trim();

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
        body: JSON.stringify({ projectId, prompt }),
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
        <span>{pending ? "Submitting" : "Run task"}</span>
        <span aria-hidden="true">-&gt;</span>
      </button>
    </form>
  );
}
