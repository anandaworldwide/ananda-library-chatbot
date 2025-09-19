#!/usr/bin/env npx tsx

/**
 * Newsletter Opt-In Migration Script
 *
 * This script opts all existing users into newsletter subscriptions by setting
 * newsletterSubscribed: true for all users who don't already have this field set.
 *
 * Usage:
 *   npx tsx scripts/newsletter-opt-in-migration.ts --site ananda --env dev --dry-run
 *   npx tsx scripts/newsletter-opt-in-migration.ts --site ananda --env prod --batch-size 50
 *
 * Options:
 *   --site: Site ID (ananda, crystal, jairam, etc.)
 *   --env: Environment (dev or prod)
 *   --batch-size: Number of users to process per batch (default: 100, max: 500)
 *   --dry-run: Preview changes without applying them
 */

import { Command } from "commander";
import admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvironmentForSite(site: string, env: string = "dev") {
  const envFile = path.join(__dirname, "..", "..", `.env.${site}`);
  dotenv.config({ path: envFile });

  // Set NODE_ENV if not already set
  if (!process.env.NODE_ENV) {
    (process.env as any).NODE_ENV = env === "prod" ? "production" : "development";
  }
}

interface MigrationStats {
  totalUsers: number;
  alreadyOptedIn: number;
  newOptIns: number;
  errors: number;
  processedBatches: number;
}

function validateArgs(site: string, env: string, batchSize: number): void {
  const validSites = ["ananda", "ananda-public", "crystal", "jairam", "photo"];
  const validEnvs = ["dev", "prod"];

  if (!validSites.includes(site)) {
    console.error(`❌ Invalid site: ${site}. Valid sites: ${validSites.join(", ")}`);
    process.exit(1);
  }

  if (!validEnvs.includes(env)) {
    console.error(`❌ Invalid environment: ${env}. Valid environments: ${validEnvs.join(", ")}`);
    process.exit(1);
  }

  if (batchSize < 1 || batchSize > 500) {
    console.error(`❌ Invalid batch size: ${batchSize}. Must be between 1 and 500`);
    process.exit(1);
  }
}

function getUsersCollectionName(env: string): string {
  return `${env}_users`;
}

async function initializeFirebase(site: string, env: string): Promise<admin.firestore.Firestore> {
  console.log(`🔧 Loading environment for site: ${site}, env: ${env}`);

  // Load environment variables for the specified site
  loadEnvironmentForSite(site, env);

  // Initialize Firebase Admin SDK
  if (!admin.apps || admin.apps.length === 0) {
    const googleCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!googleCredentials) {
      console.error(
        "❌ Missing Firebase configuration. Please check GOOGLE_APPLICATION_CREDENTIALS environment variable."
      );
      process.exit(1);
    }

    try {
      const serviceAccount = JSON.parse(googleCredentials);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      console.log("✅ Firebase Admin SDK initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Firebase Admin SDK:", error);
      process.exit(1);
    }
  }

  return admin.firestore();
}

async function getUsersNeedingOptIn(
  db: admin.firestore.Firestore,
  collectionName: string,
  batchSize: number,
  lastDocId?: string
): Promise<{ users: admin.firestore.QueryDocumentSnapshot[]; hasMore: boolean }> {
  let query = db
    .collection(collectionName)
    .where("inviteStatus", "==", "accepted") // Only process fully activated users
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(batchSize);

  if (lastDocId) {
    query = query.startAfter(lastDocId);
  }

  const snapshot = await query.get();

  // Filter users who don't have newsletterSubscribed set or have it set to false
  const usersNeedingOptIn = snapshot.docs.filter((doc) => {
    const data = doc.data();
    return data.newsletterSubscribed !== true;
  });

  return {
    users: usersNeedingOptIn,
    hasMore: snapshot.docs.length === batchSize,
  };
}

async function updateUsersBatch(
  db: admin.firestore.Firestore,
  collectionName: string,
  users: admin.firestore.QueryDocumentSnapshot[],
  dryRun: boolean
): Promise<{ success: number; errors: number }> {
  if (users.length === 0) {
    return { success: 0, errors: 0 };
  }

  if (dryRun) {
    console.log(`   📋 Would opt in ${users.length} users:`);
    users.forEach((user) => {
      const data = user.data();
      console.log(`      - ${user.id} (${data.firstName || "Unknown"} ${data.lastName || "User"})`);
    });
    return { success: users.length, errors: 0 };
  }

  const batch = db.batch();
  let successCount = 0;
  let errorCount = 0;

  try {
    users.forEach((user) => {
      const userRef = db.collection(collectionName).doc(user.id);
      batch.update(userRef, {
        newsletterSubscribed: true,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    });

    await batch.commit();
    successCount = users.length;
    console.log(`   ✅ Successfully opted in ${successCount} users`);
  } catch (error) {
    errorCount = users.length;
    console.error(`   ❌ Batch update failed:`, error);
  }

  return { success: successCount, errors: errorCount };
}

async function runMigration(site: string, env: string, batchSize: number, dryRun: boolean): Promise<MigrationStats> {
  const db = await initializeFirebase(site, env);
  const collectionName = getUsersCollectionName(env);

  console.log(`\n📊 Starting newsletter opt-in migration...`);
  console.log(`   Site: ${site}`);
  console.log(`   Environment: ${env}`);
  console.log(`   Collection: ${collectionName}`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("");

  const stats: MigrationStats = {
    totalUsers: 0,
    alreadyOptedIn: 0,
    newOptIns: 0,
    errors: 0,
    processedBatches: 0,
  };

  let lastDocId: string | undefined;
  let hasMore = true;

  while (hasMore) {
    console.log(`📦 Processing batch ${stats.processedBatches + 1}...`);

    const { users, hasMore: moreUsers } = await getUsersNeedingOptIn(db, collectionName, batchSize, lastDocId);

    hasMore = moreUsers;

    if (users.length > 0) {
      lastDocId = users[users.length - 1].id;

      const { success, errors } = await updateUsersBatch(db, collectionName, users, dryRun);

      stats.newOptIns += success;
      stats.errors += errors;
    }

    stats.processedBatches++;

    // Add a small delay between batches to avoid overwhelming Firestore
    if (hasMore) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Get total user count for reporting
  const totalSnapshot = await db
    .collection(collectionName)
    .where("inviteStatus", "==", "accepted")
    .select() // Only get document IDs for counting
    .get();

  stats.totalUsers = totalSnapshot.size;
  stats.alreadyOptedIn = stats.totalUsers - stats.newOptIns;

  return stats;
}

function printResults(stats: MigrationStats, dryRun: boolean): void {
  console.log("\n" + "=".repeat(60));
  console.log(`📈 Migration ${dryRun ? "Preview" : "Results"}`);
  console.log("=".repeat(60));
  console.log(`Total active users:        ${stats.totalUsers.toLocaleString()}`);
  console.log(`Already opted in:          ${stats.alreadyOptedIn.toLocaleString()}`);
  console.log(`${dryRun ? "Would opt in" : "Newly opted in"}:          ${stats.newOptIns.toLocaleString()}`);
  console.log(`Errors:                    ${stats.errors.toLocaleString()}`);
  console.log(`Batches processed:         ${stats.processedBatches.toLocaleString()}`);
  console.log("");

  if (stats.newOptIns > 0) {
    const percentage = ((stats.newOptIns / stats.totalUsers) * 100).toFixed(1);
    console.log(`📊 ${dryRun ? "Would update" : "Updated"} ${percentage}% of active users`);
  }

  if (dryRun) {
    console.log("🔍 This was a dry run. No changes were made to the database.");
    console.log("💡 Remove --dry-run flag to apply these changes.");
  } else {
    console.log("✅ Migration completed successfully!");
  }
  console.log("");
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("newsletter-opt-in-migration")
    .description("Opt all existing users into newsletter subscriptions")
    .requiredOption("-s, --site <site>", "Site ID (ananda, crystal, jairam, etc.)")
    .requiredOption("-e, --env <env>", "Environment (dev or prod)")
    .option("-b, --batch-size <size>", "Batch size for processing users", "100")
    .option("-d, --dry-run", "Preview changes without applying them", false);

  program.parse();
  const options = program.opts();

  const site = options.site;
  const env = options.env;
  const batchSize = parseInt(options.batchSize);
  const dryRun = options.dryRun;

  try {
    validateArgs(site, env, batchSize);

    console.log("🚀 Newsletter Opt-In Migration Script");
    console.log("=====================================");

    if (dryRun) {
      console.log("⚠️  DRY RUN MODE - No changes will be made");
    } else {
      console.log("⚠️  LIVE MODE - Changes will be applied to the database");
    }

    const stats = await runMigration(site, env, batchSize, dryRun);
    printResults(stats, dryRun);

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
