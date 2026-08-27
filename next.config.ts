import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Avoids SegmentViewNode / corrupted client manifest 500s in dev
    devtoolSegmentExplorer: false,
  },
  async headers() {
    // Scoped to API routes only. This used to match /:path* — which also
    // caught /_next/static/*, overriding Next's own immutable Cache-Control
    // on hashed JS/CSS chunks and forcing a full re-download on every
    // navigation. That was the main cause of slow tab switches.
    // API responses read a mutable in-memory session and take query params,
    // so they stay no-store rather than edge-cached.
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
