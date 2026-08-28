import {
  PostgresControlPlaneStore,
  readDatabaseUrlFromEnvironment,
} from "@ade-control-plane/database";

async function main(): Promise<void> {
  const store = new PostgresControlPlaneStore({
    applicationName: "ade-control-plane-v0-migrate",
    connectionString: await readDatabaseUrlFromEnvironment(),
    maxConnections: 1,
  });

  try {
    await store.migrate();
    console.log("V0 database migrations complete.");
  } finally {
    await store.close();
  }
}

void main().catch(() => {
  console.error("V0 database migration failed.");
  process.exitCode = 1;
});
