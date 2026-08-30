import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source, not a pre-built
  // dist — transpilePackages tells Next.js to run them through its own
  // compiler rather than expecting pre-compiled JS in node_modules.
  transpilePackages: ["@craavee/ui", "@craavee/types"],
};

export default nextConfig;
