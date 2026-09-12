import {Pool} from "pg";
import {requireEnv} from "../env";

/// One pool per process. The API runs as a long-lived process rather than as serverless functions,
/// which is why a plain pool is enough and no external pooler is needed.

let pool: Pool | undefined;

export function databaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

export function getPool(): Pool {
  pool ??= new Pool({connectionString: databaseUrl(), max: 10});
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
