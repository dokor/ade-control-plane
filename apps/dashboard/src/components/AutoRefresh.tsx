"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Controlled polling only.
 *
 * The Dashboard refreshes server-rendered reads on an interval; the scheduler
 * never depends on a browser being connected.
 */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = Math.max(5_000, intervalMs);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, interval);
    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}
