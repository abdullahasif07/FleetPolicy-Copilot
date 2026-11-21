import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * The project keeps one .env at the repository root. Read ONLY the public API URL from it
 * (never load the whole file, which also holds server secrets).
 */
function apiUrlFromRootEnv(): string | undefined {
  try {
    const text = readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const match = text.match(/^NEXT_PUBLIC_API_URL=(.*)$/m);
    return match?.[1].trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? apiUrlFromRootEnv() ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  env: { NEXT_PUBLIC_API_URL: apiUrl },
  async redirects() {
    return [{ source: "/policies", destination: "/policies/NW", permanent: false }];
  },
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
