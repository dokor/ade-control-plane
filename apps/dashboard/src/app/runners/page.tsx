import { ControlButton } from "../../components/ControlButton.js";
import { Shell } from "../../components/Shell.js";
import { requireAuthenticatedContext } from "../../lib/auth.js";
import { formatAge, formatInstant } from "../../lib/format.js";
import { getPersistence } from "../../lib/persistence.js";
import { buildOverview } from "../../lib/readModel.js";

export const dynamic = "force-dynamic";

export default async function RunnersPage() {
  const { session, config } = await requireAuthenticatedContext("/runners");
  const overview = await buildOverview({
    persistence: await getPersistence(),
    quotaProvider: config.quotaProvider,
    quotaAccountRef: config.quotaAccountRef,
  });

  return (
    <Shell
      title="Runners"
      actorRef={session.actorRef}
      refreshIntervalMs={config.refreshIntervalMs}
    >
      <p className="muted">{overview.runnerHealthSummary}</p>
      {overview.runners.length === 0 ? (
        <p className="muted">No runner is registered.</p>
      ) : (
        <div className="list">
          {overview.runners.map((runner) => (
            <article key={runner.id} className="panel">
              <div className="row">
                <strong>{runner.name}</strong>
                <span className={`badge ${runner.healthy ? "ok" : "warn"}`}>
                  {runner.state}
                </span>
              </div>
              <p className="detail">
                {runner.architecture} · {runner.activeExecutionCount} active execution(s)
              </p>
              <p className="detail">
                Heartbeat {formatAge(runner.heartbeatAgeMs)} ({formatInstant(runner.lastHeartbeatAt)})
              </p>
              <p className="detail">
                Capabilities: {runner.capabilities.length > 0 ? runner.capabilities.join(", ") : "none declared"}
              </p>
              <p className="detail">
                Labels: {runner.labels.length > 0 ? runner.labels.join(", ") : "none"}
              </p>
              <div className="actions">
                <ControlButton
                  type="runner.drain"
                  payload={{ runnerId: runner.id }}
                  label="Drain"
                  confirm={`Drain ${runner.name}? Running work finishes, no new work is dispatched.`}
                  disabled={runner.state !== "online"}
                  disabledReason="Only an online runner can be drained."
                />
                <ControlButton
                  type="runner.disable"
                  payload={{ runnerId: runner.id }}
                  label="Disable"
                  variant="danger"
                  confirm={`Disable ${runner.name}?`}
                  disabled={runner.state === "disabled"}
                  disabledReason="The runner is already disabled."
                />
                <ControlButton
                  type="runner.enable"
                  payload={{ runnerId: runner.id }}
                  label="Enable"
                  variant="primary"
                  confirm={`Re-enable ${runner.name}?`}
                  disabled={runner.state === "online"}
                  disabledReason="The runner is already online."
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}
