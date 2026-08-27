import { readFile } from "node:fs/promises";
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

export interface PostgresConnectionConfig {
  connectionString: string;
  applicationName?: string;
  maxConnections?: number;
  searchPath?: string;
}

export type SqlQueryable = Pool | PoolClient;

export function createPool(config: PostgresConnectionConfig): Pool {
  const poolConfig: PoolConfig = {
    application_name: config.applicationName,
    connectionString: config.connectionString,
    max: config.maxConnections,
  };

  if (config.searchPath) {
    poolConfig.options = `-c search_path=${config.searchPath}`;
  }

  return new Pool(poolConfig);
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function expectOne<Row extends QueryResultRow>(
  rows: readonly Row[],
  message: string,
): Row {
  const row = rows[0];
  if (!row) {
    throw new Error(message);
  }

  return row;
}

export async function readDatabaseUrlFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const directUrl = env.DATABASE_URL?.trim();
  if (directUrl) {
    return directUrl;
  }

  const filePath = env.DATABASE_URL_FILE?.trim();
  if (!filePath) {
    throw new Error("DATABASE_URL or DATABASE_URL_FILE must be set.");
  }

  const contents = await readFile(filePath, "utf8");
  const fileUrl = contents.trim();
  if (!fileUrl) {
    throw new Error(`DATABASE_URL_FILE ${filePath} is empty.`);
  }

  return fileUrl;
}
