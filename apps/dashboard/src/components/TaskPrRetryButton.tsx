"use client";

import { DashboardActionButton } from "./DashboardActionButton.js";
import { requestDashboardJson } from "../lib/apiClient.js";

export function TaskPrRetryButton({ taskId }: { taskId: string }) {
  return (
    <span className="task-stop-control">
      <DashboardActionButton
        action={() => requestDashboardJson(`/api/tasks/${taskId}/retry-pr`, { method: "POST" }, "PR retry failed.")}
        confirm="Retry GitHub pull request creation only? The agent will not run again."
        label="Retry PR only"
        pendingLabel="Requesting PR retry..."
        errorFallback="The PR retry request could not be sent."
      />
    </span>
  );
}
