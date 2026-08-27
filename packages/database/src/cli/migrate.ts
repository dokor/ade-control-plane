import { PostgresControlPlaneStore, readDatabaseUrlFromEnvironment } from "../index.js";

async function main(): Promise<void> {
  const connectionString = await readDatabaseUrlFromEnvironment();
  const store = new PostgresControlPlaneStore({
    applicationName: "ade-control-plane-migrate",
    connectionString,
    maxConnections: 1,
  });

  try {
    const applied = await store.migrate();
    if (applied.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    console.log(`Applied migrations: ${applied.join(", ")}`);
  } finally {
    await store.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
