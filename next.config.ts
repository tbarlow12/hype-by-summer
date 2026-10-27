import type { NextConfig } from "next";

// Cache Components is off: nearly every screen is per-user and request-time,
// so the classic dynamic rendering model is simpler and just as fast here.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
};

export default nextConfig;
