import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";
import { config as loadEnvFile } from "dotenv";

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

export default nextConfig;
