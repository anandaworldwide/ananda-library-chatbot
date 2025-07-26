#!/usr/bin/env npx tsx

/**
 * Location Intent Embedding Generation Script
 *
 * Purpose: One-time script to generate semantic embeddings for location intent detection
 * Usage: npx tsx web/scripts/generate-location-intent-embeddings.ts --site ananda-public
 *
 * This script:
 * 1. Reads site-specific seed phrases from web/site-config/location-intent/{site}-seeds.json
 * 2. Generates embeddings using configurable model from environment variables
 * 3. Writes embeddings to web/private/location-intent/{site}-embeddings.json
 * 4. Includes metadata: model, timestamp, seed counts, embedding dimensions
 *
 * Regeneration: Must regenerate if embedding model changes
 * Rate limits: Processes seeds in batches to respect OpenAI rate limits
 */

import { OpenAI } from "openai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load environment from project root (following established pattern)
function loadEnvironmentDirectly(site: string) {
  const projectRoot = path.join(__dirname, "..", "..");
  const envFile = path.join(projectRoot, `.env.${site}`);

  if (!existsSync(envFile)) {
    console.error(`❌ Environment file not found: ${envFile}`);
    console.error(`Available sites should have .env.${site} files in project root`);
    process.exit(1);
  }

  const result = dotenv.config({ path: envFile });
  if (result.error) {
    console.error(`❌ Error loading env file: ${result.error}`);
    process.exit(1);
  }

  console.log(`✅ Loaded environment from ${envFile}`);
}

interface SeedData {
  positive: string[];
  negative: string[];
}

interface EmbeddingData {
  model: string;
  timestamp: string;
  positiveCount: number;
  negativeCount: number;
  embeddingDimensions: number;
  positiveEmbeddings: number[][];
  negativeEmbeddings: number[][];
}

// Parse CLI arguments
function parseArgs(): { site: string } {
  const args = process.argv.slice(2);
  const siteIndex = args.indexOf("--site");

  if (siteIndex === -1 || siteIndex === args.length - 1) {
    console.error("❌ Error: --site argument is required");
    console.error("Usage: npx tsx web/scripts/generate-location-intent-embeddings.ts --site ananda-public");
    process.exit(1);
  }

  const site = args[siteIndex + 1];
  return { site };
}

// Validate required environment variables
function validateEnvironment(): { model: string; dimensions?: number } {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is required");
    console.error("Please set your OpenAI API key in your environment");
    process.exit(1);
  }

  const model = process.env.OPENAI_EMBEDDINGS_MODEL;
  if (!model) {
    console.error("❌ Error: OPENAI_EMBEDDINGS_MODEL environment variable is required");
    process.exit(1);
  }
  const dimensionsStr = process.env.OPENAI_EMBEDDINGS_DIMENSION;
  const dimensions = dimensionsStr ? parseInt(dimensionsStr, 10) : undefined;

  console.log(`✅ Using embedding model: ${model}`);
  if (dimensions) {
    console.log(`✅ Using embedding dimensions: ${dimensions}`);
  }

  return { model, dimensions };
}

// Load seed data from site-specific file
function loadSeedData(site: string): SeedData {
  const seedPath = path.join(__dirname, "..", "site-config", "location-intent", `${site}-seeds.json`);

  if (!existsSync(seedPath)) {
    console.error(`❌ Error: Seed file not found: ${seedPath}`);
    console.error(`Available sites should have seed files in web/site-config/location-intent/`);
    process.exit(1);
  }

  try {
    const seedContent = readFileSync(seedPath, "utf-8");
    const seedData: SeedData = JSON.parse(seedContent);

    if (!seedData.positive || !seedData.negative) {
      throw new Error('Seed file must contain "positive" and "negative" arrays');
    }

    if (!Array.isArray(seedData.positive) || !Array.isArray(seedData.negative)) {
      throw new Error('Both "positive" and "negative" must be arrays of strings');
    }

    return seedData;
  } catch (error) {
    console.error(`❌ Error parsing seed file: ${error}`);
    process.exit(1);
  }
}

// Generate embeddings with rate limiting
async function generateEmbeddings(
  texts: string[],
  openai: OpenAI,
  model: string,
  dimensions?: number
): Promise<number[][]> {
  const embeddings: number[][] = [];
  const batchSize = 100; // OpenAI allows up to 2048 inputs per request

  console.log(`  Generating embeddings for ${texts.length} texts in batches of ${batchSize}...`);

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    try {
      const embeddingParams: any = {
        model,
        input: batch,
      };

      // Add dimensions parameter if specified
      if (dimensions) {
        embeddingParams.dimensions = dimensions;
      }

      const response = await openai.embeddings.create(embeddingParams);

      const batchEmbeddings = response.data.map((item) => item.embedding);
      embeddings.push(...batchEmbeddings);

      console.log(`  ✅ Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);

      // Brief delay to respect rate limits
      if (i + batchSize < texts.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`❌ Error generating embeddings for batch starting at index ${i}:`, error);
      throw error;
    }
  }

  return embeddings;
}

// Write embeddings to output file
function writeEmbeddingData(site: string, embeddingData: EmbeddingData): void {
  const outputDir = path.join(__dirname, "..", "private", "location-intent");
  const outputPath = path.join(outputDir, `${site}-embeddings.json`);

  try {
    // Ensure output directory exists
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(outputPath, JSON.stringify(embeddingData, null, 2));
    console.log(`✅ Embeddings written to: ${outputPath}`);
  } catch (error) {
    console.error(`❌ Error writing embeddings file: ${error}`);
    process.exit(1);
  }
}

async function main() {
  console.log("🚀 Location Intent Embedding Generation\n");

  // Parse arguments and load environment
  const { site } = parseArgs();
  loadEnvironmentDirectly(site);
  const { model, dimensions } = validateEnvironment();

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  console.log(`📖 Loading seed data for site: ${site}`);
  const seedData = loadSeedData(site);

  console.log(`  Positive seeds: ${seedData.positive.length}`);
  console.log(`  Negative seeds: ${seedData.negative.length}`);

  try {
    // Generate embeddings for positive seeds
    console.log("\n🔮 Generating positive embeddings...");
    const positiveEmbeddings = await generateEmbeddings(seedData.positive, openai, model, dimensions);

    // Generate embeddings for negative seeds
    console.log("\n🔮 Generating negative embeddings...");
    const negativeEmbeddings = await generateEmbeddings(seedData.negative, openai, model, dimensions);

    // Prepare embedding data with metadata
    const embeddingData: EmbeddingData = {
      model,
      timestamp: new Date().toISOString(),
      positiveCount: seedData.positive.length,
      negativeCount: seedData.negative.length,
      embeddingDimensions: positiveEmbeddings[0].length,
      positiveEmbeddings,
      negativeEmbeddings,
    };

    // Write to output file
    console.log("\n💾 Writing embeddings to file...");
    writeEmbeddingData(site, embeddingData);

    console.log("\n✅ Embedding generation completed successfully!");
    console.log(`📊 Summary:`);
    console.log(`  Site: ${site}`);
    console.log(`  Model: ${embeddingData.model}`);
    console.log(`  Positive embeddings: ${embeddingData.positiveCount}`);
    console.log(`  Negative embeddings: ${embeddingData.negativeCount}`);
    console.log(`  Embedding dimensions: ${embeddingData.embeddingDimensions}`);
    console.log(`  Generated at: ${embeddingData.timestamp}`);
  } catch (error) {
    console.error("❌ Error during embedding generation:", error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
