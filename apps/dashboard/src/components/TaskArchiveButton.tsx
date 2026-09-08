"use client";

import { DashboardActionButton } from "./DashboardActionButton.js";
import { requestDashboardJson } from "../lib/apiClient.js";

/** Archives evidence from operational lists; it never deletes the task or logs. */
export function TaskArchiveButton({ taskId }: { taskId: string }) {
  return (
    <span className="task-stop-control">
      <DashboardActionButton
        action={() => requestDashboardJson(`/api/tasks/${taskId}/archive`, { method: "POST" }, "Archive failed.")}
        confirm="Archive this completed task from operational history? Its details, logs, branch and PR remain available."
        label="Archive task"
        pendingLabel="Archiving..."
        errorFallback="The task could not be archived."
      />
    </span>
  );
}
