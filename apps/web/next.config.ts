import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";
import { config as loadEnvFile } from "dotenv";
import { withSentryConfig } from "@sentry/nextjs";

// Next.js only auto-loads `.env*` from `apps/web`. This repo keeps `.env` at the
// monorepo root (see `.env.example`), so load that for DATABASE_URL, etc.
const require = createRequire(import.meta.url);
const webPackageDir = path.dirname(require.resolve("./package.json"));
const monorepoRoot = path.resolve(webPackageDir, "../..");
loadEnvFile({ path: path.join(monorepoRoot, ".env") });
loadEnvFile({ path: path.join(monorepoRoot, ".env.local") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stay-ops/shared", "@stay-ops/audit"],
};

const sentryUploadEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !sentryUploadEnabled,
  telemetry: false,
  sourcemaps: {
    disable: !sentryUploadEnabled,
  },
  release: {
    name: process.env.SENTRY_RELEASE,
    create: sentryUploadEnabled,
    finalize: sentryUploadEnabled,
  },
});
