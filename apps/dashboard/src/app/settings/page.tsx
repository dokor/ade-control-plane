import { ControlButton } from "../../components/ControlButton.js";
import { Shell } from "../../components/Shell.js";
import { requireAuthenticatedContext } from "../../lib/auth.js";
import { formatInstant } from "../../lib/format.js";
import { getPersistence } from "../../lib/persistence.js";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { session, config } = await requireAuthenticatedContext("/settings");
  const persistence = await getPersistence();
  const settings = await persistence.settings.get();

  return (
    <Shell
      title="Settings"
      actorRef={session.actorRef}
      refreshIntervalMs={config.refreshIntervalMs}
    >
      <section className="panel">
        <h2>Global scheduler mode</h2>
        <p className="value">
          <span className={`badge ${settings.schedulerMode === "running" ? "ok" : "warn"}`}>
            {settings.schedulerMode}
          </span>
        </p>
        <p className="detail">
          Last change {formatInstant(settings.updatedAt)} by {settings.updatedBy ?? "unknown"}.
        </p>
        <div className="actions">
          <ControlButton
            type="global.resume"
            label="Running"
            variant="primary"
            confirm="Resume global scheduling?"
            disabled={settings.schedulerMode === "running"}
            disabledReason="Already running."
          />
          <ControlButton
            type="global.pause"
            label="Paused"
            confirm="Pause global scheduling?"
            disabled={settings.schedulerMode === "paused"}
            disabledReason="Already paused."
          />
          <ControlButton
            type="global.safe-mode"
            label="Safe mode"
            variant="danger"
            confirm="Enable safe mode?"
            disabled={settings.schedulerMode === "safe_mode"}
            disabledReason="Already in safe mode."
          />
        </div>
      </section>

      <section className="panel">
        <h2>Quota thresholds</h2>
        <p className="detail">Throttled at {settings.quotaThrottledPercent}%</p>
        <p className="detail">Draining at {settings.quotaDrainingPercent}%</p>
        <p className="detail">Blocked at {settings.quotaBlockedPercent}%</p>
        <p className="detail">
          Snapshots older than {Math.round(settings.quotaStaleAfterMs / 1000)}s are treated as unknown.
        </p>
        <p className="muted">
          Thresholds are edited through migrations or an operator command; they are
          never editable from an unauthenticated surface.
        </p>
      </section>

      <section className="panel">
        <h2>Diagnostics</h2>
        <p className="detail">Provider: {config.quotaProvider} / {config.quotaAccountRef}</p>
        <p className="detail">Public origin: {config.publicOrigin}</p>
        <p className="detail">Session TTL: {Math.round(config.sessionTtlMs / 60_000)} minutes</p>
        <p className="muted">
          Secrets, raw environment and runner filesystem details are never rendered here.
        </p>
      </section>
    </Shell>
  );
}
