#!/usr/bin/env npx tsx

/**
 * Development Email Redirect Script
 *
 * This script redirects all user email addresses (except existing redirect emails)
 * to baseuser+[random5digits]@gmail.com for development testing.
 *
 * This ensures all emails go to the developer in development environments
 * without affecting real user email addresses in production.
 *
 * Usage:
 *   npx tsx scripts/dev-email-redirect.ts --site ananda --env dev --base-email yourname --dry-run
 *   npx tsx scripts/dev-email-redirect.ts --site ananda --env dev --base-email yourname --batch-size 50
 *
 * Options:
 *   --site: Site ID (ananda, crystal, jairam, etc.)
 *   --env: Environment (dev only - script will refuse to run on prod)
 *   --base-email: Base Gmail username (without @gmail.com) for redirected emails
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

interface RedirectStats {
  totalUsers: number;
  alreadyRedirected: number;
  redirected: number;
  errors: number;
  skipped: number;
}

function generateRandomEmail(baseEmail: string): string {
  const randomNumber = Math.floor(10000 + Math.random() * 90000); // 5-digit random number
  return `${baseEmail}+${randomNumber}@gmail.com`;
}

function isRedirectEmail(email: string, baseEmail: string): boolean {
  return email.startsWith(`${baseEmail}+`) && email.endsWith("@gmail.com");
}

function getUsersCollectionName(): string {
  const env = process.env.NODE_ENV === "production" ? "prod" : "dev";
  return `${env}_users`;
}

async function initializeFirebase(site: string, env: string): Promise<admin.firestore.Firestore> {
  console.log(`🔧 Loading environment for site: ${site}, env: ${env}`);

  // Safety check - only allow dev environment
  if (env === "prod" || env === "production") {
    console.error("❌ This script is for development only! Cannot run on production environment.");
    process.exit(1);
  }

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

async function getUsersNeedingRedirect(
  db: admin.firestore.Firestore,
  collectionName: string,
  batchSize: number,
  baseEmail: string
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const usersRef = db.collection(collectionName);

  // Get all active users (not pending invites)
  const snapshot = await usersRef.where("inviteStatus", "==", "accepted").limit(batchSize).get();

  // Filter out users who already have redirect emails
  return snapshot.docs.filter((doc) => {
    const email = doc.id; // Email is stored as document ID
    return email && !isRedirectEmail(email, baseEmail);
  });
}

async function redirectUserEmails(
  db: admin.firestore.Firestore,
  collectionName: string,
  users: admin.firestore.QueryDocumentSnapshot[],
  baseEmail: string,
  dryRun: boolean
): Promise<{ redirected: number; errors: number }> {
  let redirected = 0;
  let errors = 0;
  const usedEmails = new Set<string>();

  for (const userDoc of users) {
    try {
      const userData = userDoc.data();
      const originalEmail = userDoc.id; // Email is stored as document ID

      // Generate a unique email
      let newEmail: string;
      do {
        newEmail = generateRandomEmail(baseEmail);
      } while (usedEmails.has(newEmail));

      usedEmails.add(newEmail);

      if (dryRun) {
        console.log(
          `   📧 Would redirect: ${originalEmail} → ${newEmail} (${userData.firstName || "Unknown"} ${userData.lastName || "User"})`
        );
      } else {
        // Since email is the document ID, we need to create a new document and delete the old one
        const newUserData = {
          ...userData,
          updatedAt: admin.firestore.Timestamp.now(),
        };

        // Create new document with new email as ID
        await db.collection(collectionName).doc(newEmail).set(newUserData);

        // Delete old document
        await db.collection(collectionName).doc(originalEmail).delete();

        console.log(
          `   ✅ Redirected: ${originalEmail} → ${newEmail} (${userData.firstName || "Unknown"} ${userData.lastName || "User"})`
        );
      }

      redirected++;
    } catch (error) {
      console.error(`   ❌ Failed to redirect user ${userDoc.id}:`, error);
      errors++;
    }
  }

  return { redirected, errors };
}

async function runRedirection(
  site: string,
  env: string,
  baseEmail: string,
  batchSize: number,
  dryRun: boolean
): Promise<void> {
  const db = await initializeFirebase(site, env);
  const collectionName = getUsersCollectionName();

  console.log(`\n📊 Starting email redirection for development...`);
  console.log(`   Site: ${site}`);
  console.log(`   Environment: ${env}`);
  console.log(`   Collection: ${collectionName}`);
  console.log(`   Base email: ${baseEmail}@gmail.com`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Mode: ${dryRun ? "DRY RUN" : "LIVE UPDATE"}`);

  const stats: RedirectStats = {
    totalUsers: 0,
    alreadyRedirected: 0,
    redirected: 0,
    errors: 0,
    skipped: 0,
  };

  let batchNumber = 1;
  let hasMore = true;

  while (hasMore) {
    console.log(`\n📦 Processing batch ${batchNumber}...`);

    const users = await getUsersNeedingRedirect(db, collectionName, batchSize, baseEmail);

    if (users.length === 0) {
      hasMore = false;
      break;
    }

    // Count all users in this batch
    stats.totalUsers += users.length;

    if (users.length > 0) {
      if (dryRun) {
        console.log(`   📋 Would redirect ${users.length} users:`);
      } else {
        console.log(`   🔄 Redirecting ${users.length} users...`);
      }

      const { redirected, errors } = await redirectUserEmails(db, collectionName, users, baseEmail, dryRun);

      stats.redirected += redirected;
      stats.errors += errors;
    }

    // If we got fewer users than batch size, we're done
    if (users.length < batchSize) {
      hasMore = false;
    }

    batchNumber++;
  }

  // Get count of users who already have redirect emails
  const allUsersSnapshot = await db.collection(collectionName).where("inviteStatus", "==", "accepted").get();

  stats.alreadyRedirected = allUsersSnapshot.docs.filter((doc) => {
    const email = doc.id; // Email is stored as document ID, not as a field
    return email && isRedirectEmail(email, baseEmail);
  }).length;

  // Print final statistics
  console.log(`\n============================================================`);
  console.log(`📈 Email Redirection ${dryRun ? "Preview" : "Results"}`);
  console.log(`============================================================`);
  console.log(`Total active users:        ${stats.totalUsers + stats.alreadyRedirected}`);
  console.log(`Already redirect emails:   ${stats.alreadyRedirected}`);
  console.log(`${dryRun ? "Would redirect:" : "Redirected:"}         ${stats.redirected}`);
  console.log(`Errors:                    ${stats.errors}`);
  console.log(`Batches processed:         ${batchNumber - 1}`);

  if (stats.redirected > 0) {
    const percentage = ((stats.redirected / (stats.totalUsers + stats.alreadyRedirected)) * 100).toFixed(1);
    console.log(`\n📊 ${dryRun ? "Would redirect" : "Redirected"} ${percentage}% of active users`);
  }

  if (dryRun) {
    console.log(`🔍 This was a dry run. No changes were made to the database.`);
    console.log(`💡 Remove --dry-run flag to apply these changes.`);
  } else {
    console.log(`✅ Email redirection completed successfully!`);
    console.log(`📧 All emails will now be delivered to ${baseEmail}+*@gmail.com addresses.`);
  }
}

async function main() {
  const program = new Command();

  program
    .name("dev-email-redirect")
    .description("Redirect user emails to base+*@gmail.com for development testing")
    .requiredOption("-s, --site <site>", "Site ID (ananda, crystal, jairam, etc.)")
    .requiredOption("-e, --env <env>", "Environment (dev only)")
    .requiredOption("-b, --base-email <email>", "Base Gmail username (without @gmail.com)")
    .option("--batch-size <size>", "Batch size for processing (1-500)", "100")
    .option("-d, --dry-run", "Preview changes without applying them", false)
    .parse();

  const options = program.opts();

  // Validate environment
  if (options.env !== "dev" && options.env !== "development") {
    console.error("❌ This script only runs in development environment (--env dev)");
    process.exit(1);
  }

  // Validate base email
  const baseEmail = options.baseEmail.trim();
  if (!baseEmail || baseEmail.includes("@") || baseEmail.includes("+")) {
    console.error("❌ Base email must be a Gmail username without @gmail.com, @, or + characters");
    process.exit(1);
  }

  // Validate batch size
  const batchSize = parseInt(options.batchSize);
  if (isNaN(batchSize) || batchSize < 1 || batchSize > 500) {
    console.error("❌ Batch size must be between 1 and 500");
    process.exit(1);
  }

  console.log("🚀 Development Email Redirect Script");
  console.log("=====================================");

  if (options.dryRun) {
    console.log("⚠️  DRY RUN MODE - No changes will be made");
  } else {
    console.log("🔴 LIVE MODE - Changes will be applied to the database");
  }

  try {
    await runRedirection(options.site, options.env, baseEmail, batchSize, options.dryRun);
  } catch (error) {
    console.error("❌ Redirection failed:", error);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("❌ Script execution failed:", error);
  process.exit(1);
});
