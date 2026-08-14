import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app is intentionally local-only. Keep deployment-specific settings
  // out of the scaffold; the server scripts bind to 127.0.0.1.
  agentRules: false,
};

export default nextConfig;
