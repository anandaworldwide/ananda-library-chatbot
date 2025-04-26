// Load environment variables asynchronously in development
async function loadEnvAsync() {
  if (process.env.NODE_ENV === 'development') {
    try {
      const { loadEnv } = await import('./utils/server/loadEnv.js');
      loadEnv();
    } catch (error) {
      console.error('Failed to load environment variables:', error);
    }
  }
}

const site = process.env.SITE_ID || 'default';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev, isServer }) => {
    config.experiments = { ...config.experiments, topLevelAwait: true };

    if (dev && !isServer) {
      // Disable optimization in development mode
      config.optimization = {
        ...config.optimization,
        splitChunks: false,
      };
    }

    return config;
  },
  images: {
    domains: ['www.crystalclarity.com'],
  },
  env: {
    SITE_ID: site,
  },
};

// Wrap the config export in an async function to ensure env vars are loaded
module.exports = async () => {
  await loadEnvAsync();
  return nextConfig;
};
