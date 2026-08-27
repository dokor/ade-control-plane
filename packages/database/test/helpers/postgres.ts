import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { PostgresControlPlaneStore } from "../../src/index.js";

export interface TestStoreContext {
  adminPool: Pool;
  close(): Promise<void>;
  reopenStore(): PostgresControlPlaneStore;
  schemaName: string;
  store: PostgresControlPlaneStore;
}

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function buildSearchPath(schemaName: string): string {
  return `${schemaName},public`;
}

export async function createTestStore(): Promise<TestStoreContext> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL must be set for PostgreSQL integration tests.");
  }

  const schemaName = `test_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({
    application_name: "ade-control-plane-db-tests-admin",
    connectionString,
    max: 1,
  });
  await adminPool.query(`CREATE SCHEMA ${escapeIdentifier(schemaName)}`);

  const reopenStore = (): PostgresControlPlaneStore =>
    new PostgresControlPlaneStore({
      applicationName: "ade-control-plane-db-tests",
      connectionString,
      maxConnections: 4,
      searchPath: buildSearchPath(schemaName),
    });

  const store = reopenStore();
  await store.migrate();
  let closed = false;

  return {
    adminPool,
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      await store.close().catch(() => undefined);
      await adminPool.query(
        `DROP SCHEMA IF EXISTS ${escapeIdentifier(schemaName)} CASCADE`,
      );
      await adminPool.end();
    },
    reopenStore,
    schemaName,
    store,
  };
}
