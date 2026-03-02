import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Node.js-only packages out of the client bundle
  serverExternalPackages: ['pg', 'pg-pool', 'pg-protocol', 'bcryptjs'],

  // Suppress the workspace root lockfile warning
  outputFileTracingRoot: require('path').join(__dirname),

  // Allow Discord CDN images (avatars, icons)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
    ],
  },
};

export default nextConfig;
