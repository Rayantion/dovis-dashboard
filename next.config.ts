import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    Pin the workspace root to this directory.

    Without it, Next walks up looking for a lockfile and can settle on a parent
    directory that happens to have one — which on a developer machine silently
    changes module resolution and file tracing. Clients clone this repo into
    arbitrary paths, so the root must not depend on what sits above it.
  */
  turbopack: {
    root: __dirname,
  },

  /*
    The dashboard is served over a Cloudflare Tunnel on a client's own domain.
    These are the headers that matter for a page displaying someone's mail.
  */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Drafted email bodies must never sit in a shared or disk cache.
        source: "/api/payload/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
    ];
  },
};

export default nextConfig;
