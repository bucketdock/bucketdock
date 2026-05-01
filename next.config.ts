import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
