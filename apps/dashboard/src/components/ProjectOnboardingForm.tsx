"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";

export function ProjectOnboardingForm() {
  const router = useRouter();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ projectId: string; repository: string; branch: string } | null>(null);

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    setPlan(null);
    try {
      const body = await requestDashboardJson<{
        project?: { id?: string };
        plan?: { repository?: { url?: string }; defaultBranch?: string };
      }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryUrl, name: name || undefined, slug: slug || undefined }),
      }, "The project could not be added.");
      if (!body.project?.id || !body.plan?.repository?.url) {
        setError("ERROR: The project could not be added.");
        return;
      }
      setPlan({ projectId: body.project.id, repository: body.plan.repository.url, branch: body.plan.defaultBranch ?? "main" });
    } catch (reason) {
      setError(dashboardErrorMessage(reason, "The Dashboard could not reach the project onboarding API."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel">
      <h2>Add GitHub project</h2>
      <p className="detail">The GitHub App checks access first. The runner then creates the checkout under its configured project root.</p>
      <p className="detail">Required: GitHub App installed on the repository with metadata and contents read access; runner Git credentials able to clone the repository.</p>
      <label className="field">Repository URL<input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository" /></label>
      <label className="field">Project name (optional)<input value={name} onChange={(event) => setName(event.target.value)} placeholder="My project" /></label>
      <label className="field">Project slug (optional)<input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="my-project" /></label>
      <div className="actions"><button className="button primary" type="button" disabled={pending || !repositoryUrl.trim()} onClick={submit}>{pending ? "Checking repository..." : "Add project"}</button></div>
      {error ? <p className="task-action-error">{error}</p> : null}
      {plan ? <div className="detail"><strong>Project registered disabled.</strong><br />{plan.repository} · default branch {plan.branch}<br />The worker will create and verify the managed checkout before you enable scheduling.<br /><button className="button" type="button" onClick={() => router.push(`/projects/${plan.projectId}`)}>Open project</button></div> : null}
    </div>
  );
}
