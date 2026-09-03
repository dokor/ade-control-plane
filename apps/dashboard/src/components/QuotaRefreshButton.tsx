"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";

interface QuotaRefreshResponse {
  result?: { summary?: string };
}

export function QuotaRefreshButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshQuota() {
    setPending(true);
    setMessage(null);
    try {
      const body = await requestDashboardJson<QuotaRefreshResponse>(
        "/api/quota/refresh",
        { method: "POST" },
        "The quota refresh could not be requested.",
      );
      setMessage(body.result?.summary ?? "Quota refresh requested.");
      router.refresh();
      window.setTimeout(() => router.refresh(), 1_500);
    } catch (reason) {
      setMessage(dashboardErrorMessage(reason, "The quota refresh could not be requested."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="actions">
      <button type="button" onClick={refreshQuota} disabled={pending}>
        {pending ? "Requesting…" : "Refresh quota"}
      </button>
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}
