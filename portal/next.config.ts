import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Node.js-only packages out of the client bundle
  serverExternalPackages: ['pg', 'pg-pool', 'pg-protocol', 'bcryptjs'],

  // Suppress the workspace root lockfile warning
  outputFileTracingRoot: require('path').join(__dirname),
};

export default nextConfig;
