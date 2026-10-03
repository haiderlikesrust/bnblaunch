import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.SHEN_RUNTIME==='node'?{output:'standalone' as const}:{}),
};

export default nextConfig;
