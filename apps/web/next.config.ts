import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stay-ops/shared", "@stay-ops/audit"],
};

export default nextConfig;
