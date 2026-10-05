import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  // Lets a production build/serve run next to a dev server without both
  // fighting over .next (e.g. NEXT_DIST_DIR=.next-prod npm run build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
