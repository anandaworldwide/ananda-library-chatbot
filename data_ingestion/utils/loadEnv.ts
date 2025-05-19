import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs'; // Import fs for file system checks

export function loadEnv() {
  // Only load from .env files in development
  if (process.env.NODE_ENV !== 'development') {
    console.log('Skipping .env file loading in production environment');
    return;
  }

  const site = process.env.SITE_ID || 'default';
  // Set SITE_ID early if not already set, needed for subsequent calls potentially
  if (!process.env.SITE_ID) {
    process.env.SITE_ID = site;
  }
  console.log('loadEnv site', site);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Go up two levels: utils -> data_ingestion -> project root
  const rootDir = path.join(__dirname, '..', '..');
  const envFile = path.join(rootDir, `.env.${site}`);

  console.log(`Attempting to load environment from: ${envFile}`);

  // Check if the file exists before attempting to load
  if (!fs.existsSync(envFile)) {
    console.error(`Error: Environment file not found at ${envFile}`);
    // Optionally, throw an error to halt execution if the file is critical
    // throw new Error(`Environment file not found: ${envFile}`);
    return; // Exit the function if file not found, preventing dotenv error
  }

  // Load the environment variables from the specified file
  const result = dotenv.config({ path: envFile });

  if (result.error) {
    console.error(`Error loading ${envFile}:`, result.error);
    // Optionally, re-throw the error or handle it as needed
    // throw result.error;
  } else {
    console.log(`Loaded environment from ${envFile}`);
  }
}
