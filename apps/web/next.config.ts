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
  /** @see https://nextjs.org/docs/app/guides/memory-usage */
  experimental: {
    webpackMemoryOptimizations: true,
    serverSourceMaps: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  /**
   * CI runs `pnpm -r run typecheck`. Skipping the duplicate `tsc` pass inside `next build` saves RAM;
   * do not merge type-broken PRs (CI must stay green).
   */
  typescript: {
    ignoreBuildErrors: true,
  },
  productionBrowserSourceMaps: false,
  /**
   * pnpm installs Prisma engines under `<repo>/node_modules/.pnpm/.../.prisma/client/`.
   * Default tracing roots at `apps/web`, so Lambda never receives `libquery_engine-rhel-openssl-3.0.x*.node`.
   * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats
   */
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    // Narrow Prisma trace globs — wide `.pnpm` prisma patterns inflate NFT RAM on monorepo trace root.
    "/*": [
      "../../node_modules/.pnpm/@prisma+client@*/**/.prisma/**/*",
      "../../node_modules/.pnpm/@prisma+client@*/**/node_modules/@prisma/client/**/*",
      "../../node_modules/.pnpm/@prisma+engines@*/**/*",
    ],
  },
  /** Monorepo `outputFileTracingRoot` widens NFT; exclude paths never imported by the server bundle. */
  outputFileTracingExcludes: {
    "/*": [
      "../../packages/worker/**/*",
      "../../docs/**/*",
      "../../.github/**/*",
      "./tests/**/*",
      "../../scripts/**/*",
    ],
  },
  /**
   * Prisma Query Engine binaries must not be webpack-bundled into route chunks on Vercel.
   * Keep Node resolving `@prisma/client` + workspace DB package from node_modules at runtime.
   */
  serverExternalPackages: ["@prisma/client", "prisma", "@stay-ops/db"],
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
