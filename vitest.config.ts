import {existsSync} from "node:fs";
import {defineConfig} from "vitest/config";

// Tests talk to a real Postgres. Loading .env here means `npm test` works without a wrapper, and
// CI can supply DATABASE_URL through the environment instead.
if (existsSync(".env")) process.loadEnvFile(".env");
process.env["DATABASE_URL"] ??= "postgres://cope:cope@localhost:5432/cope";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    // Each database-backed suite creates its own database; keep them from racing on creation.
    fileParallelism: false,
    coverage: {provider: "v8", include: ["lib/**/*.ts"], exclude: ["**/*.test.ts"]},
  },
  resolve: {alias: {"@": new URL(".", import.meta.url).pathname}},
});
