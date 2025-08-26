/**
 * Migration script to add convId field to existing chat documents
 * Assigns a unique convId to each existing document (treating them as single-message conversations)
 *
 * Usage: npx tsx scripts/migrate-conv-ids.ts --site <site-name> --env <environment>
 * Example: npx tsx scripts/migrate-conv-ids.ts --site ananda --env dev
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Site-specific environment loading function
function loadEnvironmentForSite(site: string) {
  // Go up to project root from web/scripts/
  const envPath = path.join(__dirname, "..", "..", `.env.${site}`);
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.error(`Failed to load environment file: ${envPath}`);
    console.error(result.error.message);
    process.exit(1);
  }

  console.log(`Loaded environment from: ${envPath}`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const siteIndex = args.indexOf("--site");
const envIndex = args.indexOf("--env");

if (siteIndex === -1 || siteIndex + 1 >= args.length) {
  console.error("Usage: npx tsx scripts/migrate-conv-ids.ts --site <site-name> --env <environment>");
  console.error("Example: npx tsx scripts/migrate-conv-ids.ts --site ananda --env dev");
  process.exit(1);
}

const site = args[siteIndex + 1];
const environment = envIndex !== -1 && envIndex + 1 < args.length ? args[envIndex + 1] : "dev";

// Load site-specific environment
loadEnvironmentForSite(site);

// Now import Firebase after environment is loaded
import firebase from "firebase-admin";

// Initialize Firebase directly in the migration script
let db: firebase.firestore.Firestore;

try {
  const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!serviceAccountJson) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS environment variable is not set");
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  if (!firebase.apps.length) {
    firebase.initializeApp({
      credential: firebase.credential.cert(serviceAccount),
    });
  }

  db = firebase.firestore();
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
  process.exit(1);
}

// Helper function to get collection name based on script environment parameter
function getCollectionName(env: string): string {
  return `${env}_chatLogs`;
}

async function migrateConvIds() {
  console.log(`Starting convId migration for site: ${site}, environment: ${environment}`);

  // Check if db is available
  if (!db) {
    console.error("Firestore database not initialized, cannot run migration");
    console.error("Make sure FIREBASE_PROJECT_ID and other Firebase env vars are set");
    process.exit(1);
  }

  try {
    const collectionName = getCollectionName(environment);
    const answersRef = db.collection(collectionName);
    console.log(`Using collection: ${collectionName}`);

    // Get all documents that don't have a convId field
    // Note: We need to get all documents and filter client-side since Firestore
    // doesn't have a "field does not exist" query
    const snapshot = await answersRef.get();
    const docsWithoutConvId = snapshot.docs.filter((doc) => !doc.data().convId);

    console.log(`Found ${docsWithoutConvId.length} documents without convId`);

    if (docsWithoutConvId.length === 0) {
      console.log("No documents need migration. All documents already have convId.");
      return;
    }

    // Process documents in batches of 500 (Firestore batch limit)
    const batchSize = 500;
    let processedCount = 0;

    for (let i = 0; i < docsWithoutConvId.length; i += batchSize) {
      const batch = db.batch();
      const batchDocs = docsWithoutConvId.slice(i, i + batchSize);

      batchDocs.forEach((doc) => {
        // Assign unique convId to each document (treating as single-message conversation)
        const uniqueConvId = uuidv4();
        batch.update(doc.ref, { convId: uniqueConvId });
      });

      await batch.commit();
      processedCount += batchDocs.length;

      console.log(`Processed ${processedCount}/${docsWithoutConvId.length} documents`);
    }

    console.log(`✅ Migration completed successfully!`);
    console.log(`Updated ${processedCount} documents with unique convId values`);

    // Verify the migration
    const verifySnapshot = await answersRef.where("convId", "==", null).get();
    const remainingDocs = verifySnapshot.docs.length;

    if (remainingDocs === 0) {
      console.log("✅ Verification passed: All documents now have convId");
    } else {
      console.warn(`⚠️  Warning: ${remainingDocs} documents still missing convId`);
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
migrateConvIds()
  .then(() => {
    console.log("Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
