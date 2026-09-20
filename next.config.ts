import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve the project's hand-maintained AGENTS.md instructions.
  agentRules: false,
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
