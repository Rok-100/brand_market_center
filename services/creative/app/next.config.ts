import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vinext classifies multipart POST requests as progressive Server Actions
  // before dispatching App Router route handlers. Keep this above the product
  // upload traffic so video requests can reach our own validation logic. The
  // app itself does not impose a business size cap; infrastructure still has
  // finite request and storage capacity.
  experimental: {
    serverActions: {
      bodySizeLimit: "10gb",
    },
  },
};

export default nextConfig;
