"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ManualRefreshButton() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <button
      type="button"
      className="button"
      onClick={() => startRefresh(() => router.refresh())}
      disabled={refreshing}
      aria-label="Refresh dashboard data"
    >
      {refreshing ? "Refreshing..." : "Refresh"}
    </button>
  );
}
