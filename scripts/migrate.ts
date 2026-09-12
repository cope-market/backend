import {Pool} from "pg";
import {applyMigrations, loadMigrations} from "../lib/db/migrate";
import {databaseUrl} from "../lib/db/pool";

/// Applies every pending migration. Safe to run repeatedly and on every deploy.
const pool = new Pool({connectionString: databaseUrl()});
try {
  const directory = new URL("../migrations", import.meta.url).pathname;
  const applied = await applyMigrations(pool, loadMigrations(directory));
  console.log(applied.length === 0 ? "already up to date" : `applied: ${applied.join(", ")}`);
} finally {
  await pool.end();
}
