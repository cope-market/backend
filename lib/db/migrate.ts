import {readFileSync, readdirSync} from "node:fs";
import type {Pool} from "pg";

/// Applies migrations in filename order and records each one, so running it twice is safe and a
/// fresh box reaches the same schema as a running one.
///
/// Each file runs inside a transaction. A migration that fails leaves no partial schema behind and
/// no row claiming it succeeded.

export interface Migration {
  name: string;
  sql: string;
}

export function loadMigrations(directory: string): Migration[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({name, sql: readFileSync(`${directory}/${name}`, "utf8")}));
}

export async function applyMigrations(pool: Pool, migrations: Migration[]): Promise<string[]> {
  await pool.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const {rows} = await pool.query<{name: string}>("select name from schema_migrations");
  const already = new Set(rows.map((row) => row.name));
  const applied: string[] = [];

  for (const migration of migrations) {
    if (already.has(migration.name)) continue;

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(migration.sql);
      await client.query("insert into schema_migrations (name) values ($1)", [migration.name]);
      await client.query("commit");
      applied.push(migration.name);
    } catch (cause) {
      await client.query("rollback");
      throw new Error(`Migration ${migration.name} failed and was rolled back.`, {cause});
    } finally {
      client.release();
    }
  }

  return applied;
}
