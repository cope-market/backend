import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {applyMigrations, loadMigrations} from "./migrate";
import {createTestDatabase, type TestDatabase} from "./testing";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(() => db.drop());

const migration = (name: string, sql: string) => ({name, sql});

describe("loadMigrations", () => {
  it("reads the project's migrations in filename order", () => {
    const loaded = loadMigrations(new URL("../../migrations", import.meta.url).pathname);
    expect(loaded.length).toBeGreaterThan(0);
    expect([...loaded].sort((a, b) => a.name.localeCompare(b.name))).toEqual(loaded);
    expect(loaded[0]!.sql).toContain("create table");
  });
});

describe("applyMigrations", () => {
  it("applies pending migrations and reports them", async () => {
    const applied = await applyMigrations(db.pool, [
      migration("0001_a.sql", "create table a (id int)"),
      migration("0002_b.sql", "create table b (id int)"),
    ]);
    expect(applied).toEqual(["0001_a.sql", "0002_b.sql"]);

    const {rows} = await db.pool.query("select to_regclass('public.b') as present");
    expect(rows[0]!.present).toBe("b");
  });

  /// Migrations run on every deploy. A second run must be a no-op, not an error and not a repeat.
  it("is idempotent", async () => {
    const again = await applyMigrations(db.pool, [
      migration("0001_a.sql", "create table a (id int)"),
      migration("0002_b.sql", "create table b (id int)"),
    ]);
    expect(again).toEqual([]);
  });

  it("applies only what is new", async () => {
    const applied = await applyMigrations(db.pool, [
      migration("0001_a.sql", "create table a (id int)"),
      migration("0003_c.sql", "create table c (id int)"),
    ]);
    expect(applied).toEqual(["0003_c.sql"]);
  });

  /// The failure that matters: a half-applied migration leaves a schema nobody can reason about,
  /// and a recorded row would stop anyone retrying it.
  it("rolls back a failing migration and records nothing", async () => {
    await expect(
      applyMigrations(db.pool, [
        migration("0004_bad.sql", "create table d (id int); create table d (id int)"),
      ]),
    ).rejects.toThrow(/0004_bad/);

    const table = await db.pool.query("select to_regclass('public.d') as present");
    expect(table.rows[0]!.present).toBeNull();

    const recorded = await db.pool.query(
      "select 1 from schema_migrations where name = '0004_bad.sql'",
    );
    expect(recorded.rowCount).toBe(0);
  });
});
