import type { NextConfig } from "next";

const privateHeaders = [
  { key: "X-Robots-Tag", value: "noindex" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

// Product images come from the public Supabase Storage bucket of the configured project.
function supabaseImagePatterns(): NonNullable<NextConfig["images"]>["remotePatterns"] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  const url = new URL(raw);
  return [
    {
      protocol: url.protocol === "https:" ? "https" : "http",
      hostname: url.hostname,
      port: url.port,
      pathname: "/storage/v1/object/public/product-images/**",
    },
  ];
}

const isLocalSupabase = ["127.0.0.1", "localhost"].includes(
  process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : "",
);

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: supabaseImagePatterns(),
    // The optimizer refuses loopback addresses unless allowed; only the local stack needs it.
    dangerouslyAllowLocalIP: isLocalSupabase,
  },
  experimental: {
    // 4 MB upload + form overhead, below Vercel's 4.5 MB request cap.
    serverActions: { bodySizeLimit: "4.2mb" },
  },
  async headers() {
    return [
      { source: "/orders/:path*", headers: privateHeaders },
      { source: "/admin/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
