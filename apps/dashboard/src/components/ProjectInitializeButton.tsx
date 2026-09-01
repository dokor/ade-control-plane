"use client";

import { useRouter } from "next/navigation";

import { DashboardActionButton } from "./DashboardActionButton.js";
import { requestDashboardJson } from "../lib/apiClient.js";

export function ProjectInitializeButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  return (
    <DashboardActionButton
      action={() => requestDashboardJson<{ task?: { id?: string } }>(`/api/projects/${projectId}/initialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }, "Initialization could not be started.")}
      label="Initialize ADE"
      pendingLabel="Starting..."
      errorFallback="The Dashboard could not reach the initialization API."
      className="button primary"
      onSuccess={(body) => {
        if (body.task?.id) router.push(`/tasks/${body.task.id}`);
      }}
      refreshOnSuccess={false}
    />
  );
}
