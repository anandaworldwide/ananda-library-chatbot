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

// @ts-check
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Ensure React and styled-jsx are resolved from parent node_modules
  webpack: (config, { dev, isServer }) => {
    // Resolve React and styled-jsx from parent node_modules
    config.resolve.alias = {
      ...config.resolve.alias,
      'react': path.resolve(__dirname, '../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
      'styled-jsx': path.resolve(__dirname, '../node_modules/styled-jsx'),
    };
    
    // Force a single React instance
    config.resolve.modules = [
      path.resolve(__dirname, '../node_modules'),
      ...config.resolve.modules,
    ];

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

  // Add any additional Next.js config options below
  
  experimental: {
    appDir: false, // Use pages router until app router is fully implemented
  },

  // Configure path rewrites and redirects if needed
  async rewrites() {
    return [];
  },
  
  // Handle image domains for next/image if needed
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
