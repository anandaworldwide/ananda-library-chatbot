import { spawn } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const site = process.argv[2] || "default";
const envFile = path.join(__dirname, "..", `.env.${site}`);

// Load environment variables from site-specific file
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
  console.log(`Loaded environment from ${envFile}`);
} else {
  console.warn(`Warning: ${envFile} not found. Using default .env`);
  dotenv.config();
}

// CRITICAL: Make sure SITE_ID is set
process.env.SITE_ID = site;
console.log(`Starting Next.js with SITE_ID: ${site}`);

// Pass the environment to the spawned process
const nextDev = spawn("next", ["dev"], {
  stdio: "inherit",
  env: process.env,
});

nextDev.on("error", (err) => {
  console.error("Failed to start Next.js dev server:", err);
});

nextDev.on("close", (code) => {
  console.log(`Next.js dev server exited with code ${code}`);
});
