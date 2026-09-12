import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {provider: "v8", include: ["lib/**/*.ts"], exclude: ["**/*.test.ts"]},
  },
  resolve: {alias: {"@": new URL(".", import.meta.url).pathname}},
});
