#!/usr/bin/env npx tsx

/**
 * Database Cleanup Script - Remove Like System Data
 *
 * This script removes all like-related data from Firestore as part of the
 * answers page admin-only migration. It cleans up:
 * 1. {env}_likes collection (all like records)
 * 2. likeCount fields from chat logs/answers collection
 *
 * Usage:
 *   cd web && npx tsx ../scripts/cleanup-like-data.ts --site ananda --env dev [--dry-run]
 *
 * Options:
 *   --site      Site identifier (ananda, crystal, jairam, etc.)
 *   --env       Environment (dev, prod)
 *   --dry-run   Show what would be deleted without actually deleting
 *   --batch-size Batch size for processing (default: 100)
 */

import * as path from "path";
import * as dotenv from "dotenv";

// Command line argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "dry-run") {
        parsed[key] = true;
      } else {
        const value = args[i + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(`Missing value for argument: ${arg}`);
        }
        parsed[key] = value;
        i++; // Skip the value in next iteration
      }
    }
  }

  return parsed;
}

// Load environment for specific site
function loadEnvironmentForSite(site: string) {
  const envPath = path.join(process.cwd(), `.env.${site}`);
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    throw new Error(`Failed to load environment file .env.${site}: ${result.error.message}`);
  }

  console.log(`✓ Loaded environment from .env.${site}`);
}

// Initialize Firebase using the web directory's Firebase setup
async function initializeFirebase() {
  // Import Firebase from the web directory
  const { db } = await import("../web/src/services/firebase");

  // Import firebase-admin from web directory's node_modules
  const fbadmin = await import("../web/node_modules/firebase-admin");

  console.log("✓ Firebase Admin initialized");
  return { db, FieldValue: fbadmin.firestore.FieldValue };
}

// Get collection names based on environment
function getCollectionNames(env: string) {
  return {
    likes: `${env}_likes`,
    chatLogs: `${env}_chatLogs`,
  };
}

// Clean up likes collection
async function cleanupLikesCollection(
  db: any, // Firebase Firestore instance
  collectionName: string,
  batchSize: number,
  dryRun: boolean
): Promise<{ totalDeleted: number; totalFound: number }> {
  console.log(`\n📋 Processing likes collection: ${collectionName}`);

  const collection = db.collection(collectionName);
  let totalDeleted = 0;
  let totalFound = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await collection.limit(batchSize).get();

    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    totalFound += snapshot.docs.length;

    if (dryRun) {
      console.log(`  🔍 Would delete ${snapshot.docs.length} like records`);
      // For dry run, we need to manually paginate since we're not actually deleting
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      const nextSnapshot = await collection.startAfter(lastDoc).limit(1).get();
      hasMore = !nextSnapshot.empty;
    } else {
      const batch = db.batch();

      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      totalDeleted += snapshot.docs.length;
      console.log(`  ✅ Deleted ${snapshot.docs.length} like records (${totalDeleted} total)`);
    }
  }

  return { totalDeleted, totalFound };
}

// Clean up likeCount fields from chat logs
async function cleanupLikeCountFields(
  db: any, // Firebase Firestore instance
  collectionName: string,
  batchSize: number,
  dryRun: boolean,
  FieldValue: any
): Promise<{ totalUpdated: number; totalFound: number }> {
  console.log(`\n📋 Processing chat logs collection: ${collectionName}`);

  const collection = db.collection(collectionName);
  let totalUpdated = 0;
  let totalFound = 0;
  let lastDoc: any | null = null;

  while (true) {
    let query = collection.limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    const docsWithLikeCount = snapshot.docs.filter((doc) => {
      const data = doc.data();
      return data.likeCount !== undefined;
    });

    totalFound += docsWithLikeCount.length;

    if (docsWithLikeCount.length > 0) {
      if (dryRun) {
        console.log(`  🔍 Would remove likeCount from ${docsWithLikeCount.length} documents`);
      } else {
        const batch = db.batch();

        docsWithLikeCount.forEach((doc) => {
          batch.update(doc.ref, {
            likeCount: FieldValue.delete(),
          });
        });

        await batch.commit();
        totalUpdated += docsWithLikeCount.length;
        console.log(`  ✅ Removed likeCount from ${docsWithLikeCount.length} documents (${totalUpdated} total)`);
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  return { totalUpdated, totalFound };
}

// Main execution function
async function main() {
  try {
    const args = parseArgs();

    // Validate required arguments
    if (!args.site || !args.env) {
      console.error(`
Usage: npx tsx scripts/cleanup-like-data.ts --site <site> --env <env> [--dry-run] [--batch-size <size>]

Required:
  --site      Site identifier (ananda, crystal, jairam, etc.)
  --env       Environment (dev, prod)

Optional:
  --dry-run   Show what would be deleted without actually deleting
  --batch-size Batch size for processing (default: 100)

Examples:
  npx tsx scripts/cleanup-like-data.ts --site ananda --env dev --dry-run
  npx tsx scripts/cleanup-like-data.ts --site ananda --env prod --batch-size 50
`);
      process.exit(1);
    }

    const site = args.site as string;
    const env = args.env as string;
    const dryRun = !!args["dry-run"];
    const batchSize = parseInt(args["batch-size"] as string) || 100;

    console.log(`🚀 Starting like data cleanup for site: ${site}, env: ${env}`);
    console.log(`📊 Batch size: ${batchSize}`);
    console.log(`🔍 Dry run: ${dryRun ? "YES" : "NO"}`);

    if (!dryRun) {
      console.log(`\n⚠️  WARNING: This will permanently delete like data!`);
      console.log(`   Press Ctrl+C within 5 seconds to cancel...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Load environment and initialize Firebase
    loadEnvironmentForSite(site);
    const { db, FieldValue } = await initializeFirebase();

    const collections = getCollectionNames(env);

    console.log(`\n📂 Target collections:`);
    console.log(`   Likes: ${collections.likes}`);
    console.log(`   Chat Logs: ${collections.chatLogs}`);

    // Clean up likes collection
    const likesResult = await cleanupLikesCollection(db, collections.likes, batchSize, dryRun);

    // Clean up likeCount fields
    const likeCountResult = await cleanupLikeCountFields(db, collections.chatLogs, batchSize, dryRun, FieldValue);

    // Summary
    console.log(`\n📊 CLEANUP SUMMARY`);
    console.log(`==================`);

    if (dryRun) {
      console.log(`🔍 DRY RUN - No data was actually deleted`);
      console.log(`   Likes collection: ${likesResult.totalFound} records found`);
      console.log(`   Chat logs: ${likeCountResult.totalFound} documents with likeCount found`);
    } else {
      console.log(`✅ CLEANUP COMPLETED`);
      console.log(`   Likes deleted: ${likesResult.totalDeleted} records`);
      console.log(`   likeCount fields removed: ${likeCountResult.totalUpdated} documents`);
    }

    console.log(`\n🎉 Script completed successfully!`);
  } catch (error) {
    console.error(`\n❌ Error during cleanup:`, error);
    process.exit(1);
  } finally {
    // Ensure clean exit
    process.exit(0);
  }
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
