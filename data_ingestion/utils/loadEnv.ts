import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs'; // Import fs for file system checks

export function loadEnv(site?: string) {
  // Only load from .env files in development
  if (process.env.NODE_ENV !== 'development') {
    console.log('Skipping .env file loading in production environment');
    return;
  }

  // Use provided site, SITE_ID env var, or default
  const siteId = site || process.env.SITE_ID || 'default';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Go up two levels: utils -> data_ingestion -> project root
  const rootDir = path.join(__dirname, '..', '..');
  const envFile = path.join(rootDir, `.env.${siteId}`);

  // Check if the file exists before attempting to load
  if (!fs.existsSync(envFile)) {
    console.error(`Error: Environment file not found at ${envFile}`);
    throw new Error(`Environment file not found: ${envFile}`);
  }

  // Load the environment variables from the specified file
  const result = dotenv.config({ path: envFile });

  if (result.error) {
    console.error(`Error loading ${envFile}:`, result.error);
    throw result.error;
  } else {
    console.log(`Loaded environment from ${envFile}`);
  }
}
