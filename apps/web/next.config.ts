import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";
import { config as loadEnvFile } from "dotenv";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Next.js only auto-loads `.env*` from `apps/web`. This repo keeps `.env` at the
// monorepo root (see `.env.example`), so load that for DATABASE_URL, etc.
const require = createRequire(import.meta.url);
const webPackageDir = path.dirname(require.resolve("./package.json"));
const monorepoRoot = path.resolve(webPackageDir, "../..");
loadEnvFile({ path: path.join(monorepoRoot, ".env") });
loadEnvFile({ path: path.join(monorepoRoot, ".env.local") });

/**
 * One release name for source maps (build) and for events (runtime, all three Sentry runtimes):
 * explicit SENTRY_RELEASE wins; otherwise "<package>@<version>+<7-char commit>" from the Vercel
 * commit (VERCEL_GIT_COMMIT_SHA) so every deploy is its own release. `undefined` for local builds.
 */
function resolveSentryRelease(): string | undefined {
  const explicit = process.env.SENTRY_RELEASE?.trim();
  if (explicit) return explicit;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (!sha) return undefined;
  const { version } = require("./package.json") as { version: string };
  return `stay-ops-web@${version}+${sha.slice(0, 7)}`;
}

const sentryRelease = resolveSentryRelease();

/** `next dev` needs eval for fast refresh; the production build never does. */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://vercel.live`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://vercel.live https://vercel.com",
  "font-src 'self' data: https://vercel.live",
  "connect-src 'self' https://*.sentry.io https://vercel.live wss://ws-us3.pusher.com",
  "frame-src https://vercel.live",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Inlined into the browser bundle so client events carry the same release as the uploaded source maps.
  env: sentryRelease ? { NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease } : {},
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
    // Only the generated client and its query engine: everything else under @prisma/client is traced
    // from its own requires. Keep this narrow: Vercel packs routes into functions of at most 250 MB, and
    // the Hobby plan allows 12 functions per deployment, so every MB here multiplies the function count.
    "/*": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*"],
  },
  /** Monorepo `outputFileTracingRoot` widens NFT; exclude paths never imported by the server bundle. */
  outputFileTracingExcludes: {
    "/*": [
      "../../docs/**/*",
      "../../.github/**/*",
      "./tests/**/*",
      "../../scripts/**/*",
      // Prisma files the Node query engine never loads at runtime: migration/schema engines, other
      // platforms' engines (Vercel runs rhel), WASM/edge runtimes, source maps and type definitions.
      "../../node_modules/.pnpm/@prisma+engines@*/**/*",
      "../../node_modules/.pnpm/@prisma+client@*/**/libquery_engine-debian-*",
      "../../node_modules/.pnpm/@prisma+client@*/**/libquery_engine-darwin*",
      "../../node_modules/.pnpm/@prisma+client@*/**/query_engine-windows*",
      "../../node_modules/.pnpm/@prisma+client@*/**/*.wasm",
      "../../node_modules/.pnpm/@prisma+client@*/**/*.wasm-base64.*",
      "../../node_modules/.pnpm/@prisma+client@*/**/*.map",
      "../../node_modules/.pnpm/@prisma+client@*/**/*.d.ts",
      "../../node_modules/.pnpm/@prisma+client@*/**/*.d.mts",
    ],
  },
  /**
   * Prisma Query Engine binaries must not be webpack-bundled into route chunks on Vercel.
   * Keep Node resolving `@prisma/client` + workspace DB package from node_modules at runtime.
   */
  serverExternalPackages: ["@prisma/client", "prisma", "@stay-ops/db"],
  /**
   * Browser safety headers on every response. The CSP lets the page load code, styles, fonts and images only from
   * the app itself, and send data only to the app and Sentry. Inline scripts stay allowed because Next.js writes
   * its page data inline; nonces would make every page dynamic and slower, which this two-user app does not need.
   * vercel.live is the Vercel toolbar on preview deployments.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

const sentryUploadEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(withNextIntl(nextConfig), {
  ...(process.env.SENTRY_ORG !== undefined ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT !== undefined ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN !== undefined ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),
  silent: !sentryUploadEnabled,
  telemetry: false,
  sourcemaps: {
    disable: !sentryUploadEnabled,
  },
  release: {
    ...(sentryRelease !== undefined ? { name: sentryRelease } : {}),
    create: sentryUploadEnabled,
    finalize: sentryUploadEnabled,
  },
});
