import { Suspense } from "react";
import { ControlButton } from "../components/ControlButton.js";
import { QuotaRefreshButton } from "../components/QuotaRefreshButton.js";
import { OverviewContent, OverviewLoading, OverviewUnavailable } from "../components/OverviewContent.js";
import { Shell } from "../components/Shell.js";
import { requireAuthenticatedContext } from "../lib/auth.js";
import type { DashboardConfig } from "../lib/config.js";
import { getPersistence } from "../lib/persistence.js";
import { buildOverview, type OverviewViewModel } from "../lib/readModel.js";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { session, config } = await requireAuthenticatedContext("/");
  return <Shell title="Dashboard" actorRef={session.actorRef} refreshIntervalMs={config.refreshIntervalMs}>
    <Suspense fallback={<OverviewLoading />}><OverviewData config={config} /></Suspense>
  </Shell>;
}

async function OverviewData({ config }: { config: DashboardConfig }) {
  let overview: OverviewViewModel | null = null;
  try {
    overview = await buildOverview({
      persistence: await getPersistence(), quotaProvider: config.quotaProvider,
      quotaAccountRef: config.quotaAccountRef, adeRuntimeVersion: config.adeRuntimeVersion,
      tolerateUnavailable: true,
    });
  } catch {
    // Never serialize a database connection error into the page.
    console.error("Overview read model unavailable");
  }
  return overview ? <OverviewContent overview={overview} quotaControl={<QuotaRefreshButton />} controls={<div className="actions">
      <ControlButton type={overview.schedulerMode === "running" ? "global.pause" : "global.resume"}
        label={overview.schedulerMode === "running" ? "Pause globally" : "Resume scheduling"}
        confirm={overview.schedulerMode === "running" ? "Pause all scheduling?" : "Resume global scheduling?"} />
      <ControlButton type="global.safe-mode" label="Safe mode" confirm="Enable safe mode? Only reconciliation continues."
        disabled={overview.schedulerMode === "safe_mode"} disabledReason="Safe mode is already enabled." />
    </div>} /> : <OverviewUnavailable />;
}
