import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here is per-user, authenticated data, so nothing is prerendered or cached across users.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
