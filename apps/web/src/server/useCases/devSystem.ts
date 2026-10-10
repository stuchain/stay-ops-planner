import pkg from "../../../package.json";
import { prisma } from "@/lib/prisma";

export type SystemInfo = {
  version: string;
  /** Full commit of this deploy; null for a local run. */
  commit: string | null;
  database: { ok: true; pingMs: number; migrations: number } | { ok: false };
  /** Where errors are collected, when the deploy knows (SENTRY_DASHBOARD_URL, or SENTRY_ORG and SENTRY_PROJECT). */
  sentryUrl: string | null;
};

export function sentryLink(env: Record<string, string | undefined> = process.env): string | null {
  const direct = env.SENTRY_DASHBOARD_URL?.trim();
  if (direct && /^https:\/\//.test(direct)) return direct;
  const org = env.SENTRY_ORG?.trim();
  const project = env.SENTRY_PROJECT?.trim();
  if (org && project) {
    return `https://sentry.io/organizations/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}/`;
  }
  return null;
}

/** App version, database status and the Sentry link, for the Dev mode System page. */
export async function systemInfo(): Promise<SystemInfo> {
  const started = Date.now();
  let database: SystemInfo["database"];
  try {
    await prisma.$queryRaw`SELECT 1`;
    const pingMs = Date.now() - started;
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    database = { ok: true, pingMs, migrations: Number(rows[0]?.count ?? 0) };
  } catch {
    database = { ok: false };
  }
  return {
    version: pkg.version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    database,
    sentryUrl: sentryLink(),
  };
}
