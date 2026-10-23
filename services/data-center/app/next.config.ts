import type { NextConfig } from "next";

const integratedPrefix = process.env.HUB_SAME_ORIGIN_BUILD === "1"
  ? "/yxb/wis-marketing-hub/modules/data-center"
  : undefined;

const nextConfig: NextConfig = {
  basePath: integratedPrefix,
  assetPrefix: integratedPrefix,
};

export default nextConfig;
