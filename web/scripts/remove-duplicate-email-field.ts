#!/usr/bin/env npx tsx

/**
 * Remove Duplicate Email Field Migration
 *
 * This script removes the duplicate 'email' field from user documents where it matches
 * the document ID. It also cleans up any 'originalEmail' fields (development artifacts).
 * After this migration, the document ID will be the source of truth for the user's email address.
 *
 * Usage:
 *   npx tsx web/scripts/remove-duplicate-email-field.ts --site ananda --env dev --dry-run
 *   npx tsx web/scripts/remove-duplicate-email-field.ts --site ananda --env dev --batch-size 50
 *   npx tsx web/scripts/remove-duplicate-email-field.ts --site ananda --env dev --force-mismatched
 *
 * Options:
 *   --site: Site ID (ananda, crystal, jairam, etc.)
 *   --env: Environment (dev or prod)
 *   --batch-size: Number of users to process per batch (default: 100, max: 500)
 *   --dry-run: Preview changes without applying them
 *   --force-mismatched: Override mismatched email fields (use doc ID as source of truth)
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
  duplicateEmailUsers: number;
  mismatchedEmailUsers: number;
  updatedUsers: number;
  errors: number;
}

function getUsersCollectionName(): string {
  const env = process.env.NODE_ENV === "production" ? "prod" : "dev";
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

async function analyzeUsers(
  db: admin.firestore.Firestore,
  collectionName: string
): Promise<{
  duplicateUsers: admin.firestore.QueryDocumentSnapshot[];
  mismatchedUsers: admin.firestore.QueryDocumentSnapshot[];
  stats: MigrationStats;
}> {
  console.log(`📊 Analyzing users in ${collectionName}...`);

  const usersSnapshot = await db.collection(collectionName).get();
  const duplicateUsers: admin.firestore.QueryDocumentSnapshot[] = [];
  const mismatchedUsers: admin.firestore.QueryDocumentSnapshot[] = [];

  const stats: MigrationStats = {
    totalUsers: usersSnapshot.size,
    duplicateEmailUsers: 0,
    mismatchedEmailUsers: 0,
    updatedUsers: 0,
    errors: 0,
  };

  usersSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const docId = doc.id;
    const emailField = data.email;

    if (emailField) {
      if (emailField === docId) {
        // Email field matches doc ID - this is a duplicate we can remove
        duplicateUsers.push(doc);
        stats.duplicateEmailUsers++;
      } else {
        // Email field doesn't match doc ID - this needs attention
        mismatchedUsers.push(doc);
        stats.mismatchedEmailUsers++;
      }
    }
  });

  return { duplicateUsers, mismatchedUsers, stats };
}

async function removeDuplicateEmailFields(
  db: admin.firestore.Firestore,
  users: admin.firestore.QueryDocumentSnapshot[],
  dryRun: boolean
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  // Process in batches to respect Firestore limits
  const batchSize = 500; // Firestore batch limit
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = db.batch();
    const batchUsers = users.slice(i, i + batchSize);

    batchUsers.forEach((doc) => {
      try {
        const data = doc.data();
        if (dryRun) {
          console.log(
            `   📋 Would remove email field${data.originalEmail ? " and originalEmail field" : ""} for: ${doc.id} (${data.firstName || "Unknown"} ${data.lastName || "User"})`
          );
        } else {
          const fieldsToDelete: any = {
            email: admin.firestore.FieldValue.delete(),
          };

          // Also remove originalEmail field if it exists (development artifact)
          if (data.originalEmail) {
            fieldsToDelete.originalEmail = admin.firestore.FieldValue.delete();
          }

          batch.update(doc.ref, fieldsToDelete);
          console.log(
            `   ✅ Removing email field${data.originalEmail ? " and originalEmail field" : ""} for: ${doc.id} (${data.firstName || "Unknown"} ${data.lastName || "User"})`
          );
        }
        updated++;
      } catch (error) {
        console.error(`   ❌ Error processing user ${doc.id}:`, error);
        errors++;
      }
    });

    if (!dryRun && batchUsers.length > 0) {
      await batch.commit();
      console.log(`   💾 Committed batch of ${batchUsers.length} updates`);
    }
  }

  return { updated, errors };
}

async function runMigration(
  site: string,
  env: string,
  batchSize: number,
  dryRun: boolean,
  forceMismatched: boolean = false
): Promise<void> {
  const db = await initializeFirebase(site, env);
  const collectionName = getUsersCollectionName();

  console.log(`\n📊 Starting duplicate email field removal migration...`);
  console.log(`   Site: ${site}`);
  console.log(`   Environment: ${env}`);
  console.log(`   Collection: ${collectionName}`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Mode: ${dryRun ? "DRY RUN" : "LIVE UPDATE"}`);

  // Analyze users
  const { duplicateUsers, mismatchedUsers, stats } = await analyzeUsers(db, collectionName);

  console.log(`\n📈 Analysis Results:`);
  console.log(`   Total users: ${stats.totalUsers}`);
  console.log(`   Users with duplicate email field: ${stats.duplicateEmailUsers}`);
  console.log(`   Users with mismatched email field: ${stats.mismatchedEmailUsers}`);

  // Handle mismatched users
  if (mismatchedUsers.length > 0) {
    console.log(`\n⚠️  Found ${mismatchedUsers.length} users with mismatched email fields:`);
    mismatchedUsers.slice(0, 10).forEach((doc) => {
      const data = doc.data();
      console.log(
        `   🔍 Doc ID: ${doc.id}, Email Field: ${data.email}, Name: ${data.firstName || "Unknown"} ${data.lastName || "User"}`
      );
    });
    if (mismatchedUsers.length > 10) {
      console.log(`   ... and ${mismatchedUsers.length - 10} more`);
    }

    if (forceMismatched) {
      console.log(`\n🔧 --force-mismatched flag detected. Will override mismatched email fields with doc ID.`);
      console.log(`   ⚠️  This will use the document ID as the source of truth for email addresses.`);
    } else {
      console.log(`\n   These users need manual review before migration.`);
      console.log(`   Consider running the dev-email-redirect script first if these are redirect emails.`);
      console.log(`   Or use --force-mismatched to override and use doc ID as source of truth.`);
    }
  }

  // Determine which users to process
  let usersToProcess = duplicateUsers;
  if (forceMismatched && mismatchedUsers.length > 0) {
    usersToProcess = [...duplicateUsers, ...mismatchedUsers];
    console.log(
      `\n🔄 Processing ${duplicateUsers.length} duplicate + ${mismatchedUsers.length} mismatched = ${usersToProcess.length} total users...`
    );
  } else if (duplicateUsers.length > 0) {
    console.log(`\n🔄 Processing ${duplicateUsers.length} users with duplicate email fields...`);
  }

  // Process users
  if (usersToProcess.length > 0) {
    const { updated, errors } = await removeDuplicateEmailFields(db, usersToProcess, dryRun);
    stats.updatedUsers = updated;
    stats.errors = errors;
  } else {
    console.log(`\n✅ No users found with email fields to remove.`);
  }

  // Print final statistics
  console.log(`\n============================================================`);
  console.log(`📈 Migration ${dryRun ? "Preview" : "Results"}`);
  console.log(`============================================================`);
  console.log(`Total users:               ${stats.totalUsers}`);
  console.log(`Duplicate email fields:    ${stats.duplicateEmailUsers}`);
  console.log(`Mismatched email fields:   ${stats.mismatchedEmailUsers}`);
  console.log(`${dryRun ? "Would update:" : "Updated:"}              ${stats.updatedUsers}`);
  console.log(`Errors:                    ${stats.errors}`);

  const totalEligible = stats.duplicateEmailUsers + (forceMismatched ? stats.mismatchedEmailUsers : 0);
  if (totalEligible > 0) {
    const percentage = ((stats.updatedUsers / totalEligible) * 100).toFixed(1);
    console.log(`\n📊 ${dryRun ? "Would process" : "Processed"} ${percentage}% of eligible email fields`);
  }

  if (dryRun) {
    console.log(`🔍 This was a dry run. No changes were made to the database.`);
    console.log(`💡 Remove --dry-run flag to apply these changes.`);
  } else {
    console.log(`✅ Migration completed successfully!`);
    if (stats.mismatchedEmailUsers > 0 && !forceMismatched) {
      console.log(`⚠️  Note: ${stats.mismatchedEmailUsers} users with mismatched emails were not processed.`);
      console.log(`   Use --force-mismatched to override and process these users.`);
    }
  }
}

async function main() {
  const program = new Command();

  program
    .name("remove-duplicate-email-field")
    .description("Remove duplicate email fields from user documents where email field matches document ID")
    .requiredOption("-s, --site <site>", "Site ID (ananda, crystal, jairam, etc.)")
    .requiredOption("-e, --env <env>", "Environment (dev or prod)")
    .option("--batch-size <size>", "Batch size for processing (1-500)", "100")
    .option("-d, --dry-run", "Preview changes without applying them", false)
    .option("--force-mismatched", "Override mismatched email fields (use doc ID as source of truth)", false)
    .parse();

  const options = program.opts();

  // Validate batch size
  const batchSize = parseInt(options.batchSize);
  if (isNaN(batchSize) || batchSize < 1 || batchSize > 500) {
    console.error("❌ Batch size must be between 1 and 500");
    process.exit(1);
  }

  console.log("🚀 Remove Duplicate Email Field Migration");
  console.log("=========================================");

  if (options.dryRun) {
    console.log("⚠️  DRY RUN MODE - No changes will be made");
  } else {
    console.log("🔴 LIVE MODE - Changes will be applied to the database");
  }

  try {
    await runMigration(options.site, options.env, batchSize, options.dryRun, options.forceMismatched);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("❌ Script execution failed:", error);
  process.exit(1);
});
