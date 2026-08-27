import {
  PostgresControlPlaneStore,
  readDatabaseUrlFromEnvironment,
  type ControlPlanePersistence,
} from "@ade-control-plane/database";

let store: Promise<ControlPlanePersistence> | null = null;

/**
 * One pooled store per server process. The Dashboard only ever reads through
 * repositories and writes through the control command pipeline; it never opens an
 * ad-hoc connection or runs raw SQL from a request handler.
 */
export function getPersistence(): Promise<ControlPlanePersistence> {
  store ??= (async () => {
    const connectionString = await readDatabaseUrlFromEnvironment();
    return new PostgresControlPlaneStore({
      connectionString,
      applicationName: "ade-control-plane-dashboard",
      maxConnections: 5,
    });
  })();
  return store;
}
