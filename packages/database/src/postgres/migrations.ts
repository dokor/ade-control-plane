import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import { withTransaction } from "./connection.js";

interface MigrationFile {
  version: string;
  sql: string;
}

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

export async function migrate(pool: Pool): Promise<readonly string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = await loadMigrationFiles();
  const applied = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  const appliedVersions = new Set(applied.rows.map(({ version }) => version));
  const pending = files.filter(({ version }) => !appliedVersions.has(version));

  for (const migrationFile of pending) {
    await withTransaction(pool, async (client) => {
      await client.query(migrationFile.sql);
      await client.query(
        `
          INSERT INTO schema_migrations (version, applied_at)
          VALUES ($1, CURRENT_TIMESTAMP)
        `,
        [migrationFile.version],
      );
    });
  }

  return pending.map(({ version }) => version);
}

async function loadMigrationFiles(): Promise<readonly MigrationFile[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    sqlFiles.map(async (fileName) => ({
      version: fileName.replace(/\.sql$/, ""),
      sql: await readFile(join(migrationsDirectory, fileName), "utf8"),
    })),
  );
}
