"use client";

import { DashboardActionButton } from "./DashboardActionButton.js";
import { requestDashboardJson } from "../lib/apiClient.js";

export function TaskCancelButton({
  taskId,
  status,
}: {
  taskId: string;
  status: "PENDING" | "RUNNING";
}) {
  return (
    <div className="task-stop-control">
      <DashboardActionButton
        action={() => requestDashboardJson(`/api/tasks/${taskId}/cancel`, {
          method: "POST",
        }, "Cancellation failed.")}
        confirm={status === "RUNNING" ? "Stop the active Codex process?" : "Cancel this queued task?"}
        label={status === "RUNNING" ? "Stop Codex" : "Cancel task"}
        pendingLabel="Requesting stop..."
        errorFallback="The cancellation request could not be sent."
        className="danger"
      />
    </div>
  );
}
