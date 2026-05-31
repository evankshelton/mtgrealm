/** @type {import('next').NextConfig} */
const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

const nextConfig = {
  reactStrictMode: true,
  // Same-origin proxy so cookies set by the Go API on the /api path
  // land on the browser without cross-origin shenanigans.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cards.scryfall.io" },
      { protocol: "https", hostname: "backs.scryfall.io" },
    ],
  },
};

export default nextConfig;
