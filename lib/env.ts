import {existsSync} from "node:fs";

/// Next loads .env for the app automatically. Standalone scripts do not get that, so they call this
/// first. Real environment variables already set are left alone, which is how a VPS or CI supplies
/// configuration without a file.
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (existsSync(".env")) process.loadEnvFile(".env");
}

/// Reads a required variable, failing loudly at startup rather than at the first request that needs
/// it.
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}
