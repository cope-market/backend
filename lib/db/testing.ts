import {Pool} from "pg";
import {randomUUID} from "node:crypto";

/// Each suite gets its own database, created and dropped around it. Tests that share a database
/// pass or fail depending on what ran before them, which is a slower and more confusing way to find
/// out that a query was wrong.

const ADMIN_URL = process.env["DATABASE_URL"] ?? "postgres://cope:cope@localhost:5432/cope";

export interface TestDatabase {
  pool: Pool;
  drop: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `cope_test_${randomUUID().replace(/-/g, "")}`;
  const admin = new Pool({connectionString: ADMIN_URL});
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new Pool({connectionString: url.toString()});

  return {
    pool,
    drop: async () => {
      await pool.end();
      const cleanup = new Pool({connectionString: ADMIN_URL});
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}
