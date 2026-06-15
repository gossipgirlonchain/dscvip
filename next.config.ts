import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const RADAR = "https://dsc-reply-radar-production.up.railway.app";

const nextConfig: NextConfig = {
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  async rewrites() {
    return [
      { source: "/radar", destination: `${RADAR}/radar` },
      { source: "/radar/:path*", destination: `${RADAR}/radar/:path*` },
    ];
  },
};

export default nextConfig;
