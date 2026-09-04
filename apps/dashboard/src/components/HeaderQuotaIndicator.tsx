import Link from "next/link";
import { evaluateQuota, type QuotaDecision } from "@ade-control-plane/quota";

import { loadDashboardConfig } from "../lib/config.js";
import { getPersistence } from "../lib/persistence.js";
import { StatusBadge } from "./StatusBadge.js";

interface HeaderQuotaView {
  state: QuotaDecision["state"];
  availablePercent: number | null;
}

export async function HeaderQuotaIndicator() {
  const quota = await loadHeaderQuota();
  const label = quota.availablePercent === null
    ? "Quota unknown"
    : `${Math.max(0, 100 - quota.availablePercent === 100 ? 100 : quota.availablePercent)}% available`;

  return (
    <Link href="/#capacity" aria-label={`AI quota: ${label}, ${quota.state}`}>
      Quota <StatusBadge status={quota.state}>{label}</StatusBadge>
    </Link>
  );
}

async function loadHeaderQuota(): Promise<HeaderQuotaView> {
  try {
    const config = await loadDashboardConfig();
    const persistence = await getPersistence();
    const [settings, snapshot] = await Promise.all([
      persistence.settings.get(),
      persistence.providerQuotaSnapshots.getLatest(config.quotaProvider, config.quotaAccountRef),
    ]);

    if (!snapshot) return { state: "unknown", availablePercent: null };

    const decision = evaluateQuota(
      {
        provider: snapshot.provider,
        accountRef: snapshot.accountRef,
        usedPercent: snapshot.usedPercent,
        ...(snapshot.windowDurationMins !== null ? { windowDurationMins: snapshot.windowDurationMins } : {}),
        observedAt: snapshot.observedAt,
        ...(snapshot.expiresAt ? { expiresAt: snapshot.expiresAt } : {}),
        ...(snapshot.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
      },
      {
        throttledAtPercent: settings.quotaThrottledPercent,
        drainingAtPercent: settings.quotaDrainingPercent,
        blockedAtPercent: settings.quotaBlockedPercent,
        staleAfterMs: settings.quotaStaleAfterMs,
        allowStartWhenUnknown: false,
      },
      new Date().toISOString(),
    );

    return {
      state: decision.state,
      availablePercent: snapshot.usedPercent === null ? null : Math.max(0, 100 - snapshot.usedPercent),
    };
  } catch {
    return { state: "unknown", availablePercent: null };
  }
}
