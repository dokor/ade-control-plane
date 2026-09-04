"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";
import { ProjectSetupPanel, type ProjectSetupPanelProps } from "./ProjectSetupPanel.js";

export function ProjectSetupAssistant(props: Pick<ProjectSetupPanelProps, "project" | "work" | "readiness" | "refreshIntervalMs">) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  // The server owns PR state across reloads. Keep the mutation result only until
  // a newer repository inspection arrives (including a merged/closed PR).
  const [createdPr, setCreatedPr] = useState<{ url: string; checkedAt: string } | null>(null);
  const readiness = createdPr?.checkedAt === props.readiness.checkedAt
    ? { ...props.readiness, setupPullRequestUrl: createdPr.url } : props.readiness;

  async function prepare(): Promise<void> {
    setPending(true); setMessage(null); setError(false);
    try {
      const body = await requestDashboardJson<{
        result?: { labelsCreated?: readonly string[]; pullRequestUrl?: string | null; initializationTask?: { id: string } | null };
      }>(`/api/projects/${props.project.id}/setup`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare" }),
      }, "Setup could not be prepared.");
      if (!body.result) throw new Error("Setup could not be prepared.");
      if (body.result.initializationTask?.id) { router.push(`/tasks/${body.result.initializationTask.id}`); return; }
      if (body.result.pullRequestUrl) setCreatedPr({ url: body.result.pullRequestUrl, checkedAt: props.readiness.checkedAt });
      setMessage(body.result.pullRequestUrl ? "Setup PR prepared for review." : "Setup checks updated.");
      router.refresh();
    } catch (reason) {
      setError(true);
      setMessage(dashboardErrorMessage(reason, "The Dashboard could not reach the setup API."));
    } finally { setPending(false); }
  }

  return <ProjectSetupPanel {...props} readiness={readiness} pending={pending} refreshing={refreshing}
    message={message} error={error} onPrepare={() => void prepare()} onRefresh={() => startRefresh(() => router.refresh())} />;
}
