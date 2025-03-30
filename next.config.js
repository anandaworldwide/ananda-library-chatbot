import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './utils/server/loadEnv.js';

// Only load from .env file in development
if (process.env.NODE_ENV === 'development') {
  loadEnv();
}

const site = process.env.SITE_ID || 'default';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, 'site-config', 'config.json');
const configData = fs.readFileSync(configPath, 'utf8');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true,
  },
  webpack: (config, { dev, isServer }) => {
    config.experiments = { ...config.experiments, topLevelAwait: true };

    if (dev && !isServer) {
      // Disable optimization in development mode.
      config.optimization = {
        ...config.optimization,
        splitChunks: false,
      };
    }

    return config;
  },
  async rewrites() {
    // Ensure we have a valid base URL, defaulting to a relative path if not set
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';

    return [
      {
        source: '/api/sudoCookie',
        destination: `${baseUrl}/api/sudoCookie`,
      },
    ];
  },
  env: {
    SITE_ID: site,
    SITE_CONFIG: configData,
  },
  images: {
    domains: ['www.crystalclarity.com'],
  },
};

export default nextConfig;
