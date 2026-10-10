import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPackageDir = path.resolve(here, "../../../../packages/db");

let container: StartedPostgreSqlContainer | undefined;

function runInDbPackage(args: string[], databaseUrl: string): void {
  const r = spawnSync("corepack", ["pnpm", ...args], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed with exit code ${r.status}`);
}

/**
 * One Postgres per run. An existing `TEST_DATABASE_URL` wins (local docker compose, CI service);
 * otherwise a postgres:16 Testcontainer is started and removed in teardown.
 */
export async function setup(): Promise<void> {
  let url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) {
    container = await new PostgreSqlContainer("postgres:16")
      .withDatabase("stayops_test")
      .withUsername("stayops")
      .withPassword("stayops")
      .start();
    url = container.getConnectionUri();
  }
  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
  runInDbPackage(["run", "migrate:deploy"], url);
  runInDbPackage(["run", "seed"], url);
}

export async function teardown(): Promise<void> {
  if (container) {
    await container.stop();
    container = undefined;
  }
}
