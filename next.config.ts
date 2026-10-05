import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  // Lets a production build/serve run next to a dev server without both
  // fighting over .next (e.g. NEXT_DIST_DIR=.next-prod npm run build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // the floating dev-tools button sits on the HUD's bottom-left corner (the 岔路 button on phones)
  devIndicators: false,
};

export default nextConfig;
