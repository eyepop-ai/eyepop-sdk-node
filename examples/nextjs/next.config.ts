import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Add alias for workspace packages
    config.resolve.alias = {
      ...config.resolve.alias,
      '@eyepop.ai/eyepop': path.resolve(__dirname, '../../src/eyepop'),
      '@eyepop.ai/eyepop-render-2d': path.resolve(__dirname, '../../src/eyepop-render-2d'),
    };
    
    return config;
  },
};

export default nextConfig;
