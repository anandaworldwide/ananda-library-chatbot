#!/usr/bin/env node

/**
 * Cleanup Empty Answers Script
 *
 * This script identifies and deletes question-answer pairs from Firestore where:
 * - The answer field is empty, null, or very short (< 5 characters)
 * - Removes references to these documents from other documents' relatedQuestionsV2 arrays
 *
 * We had a bug where answers were occasionally not stored. This is clean up for that.
 *
 * Usage:
 *   node web/scripts/cleanup_empty_answers.js --env [dev|prod] [--dry-run] [--batch-size 100]
 *
 * Options:
 *   --env: Environment to clean (dev or prod) - REQUIRED
 *   --dry-run: Show what would be deleted without actually deleting
 *   --batch-size: Number of documents to process per batch (default: 100)
 *   --help: Show this help message
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get current directory for relative path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Command line argument parsing
const args = process.argv.slice(2);
const options = {
  site: null,
  env: null,
  dryRun: false,
  batchSize: 100,
  help: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--site":
      options.site = args[++i];
      break;
    case "--env":
      options.env = args[++i];
      break;
    case "--dry-run":
      options.dryRun = true;
      break;
    case "--batch-size":
      options.batchSize = parseInt(args[++i]);
      break;
    case "--help":
      options.help = true;
      break;
  }
}

if (options.help) {
  console.log(`
Cleanup Empty Answers Script

This script identifies and deletes question-answer pairs from Firestore where:
- The answer field is empty, null, or very short (< 5 characters)
- Removes references to these documents from other documents' relatedQuestionsV2 arrays

Usage:
  node web/scripts/cleanup_empty_answers.js --site [site] --env [dev|prod] [--dry-run] [--batch-size 100]

Options:
  --site: Site identifier for environment file (e.g., ananda, crystal) - REQUIRED
  --env: Environment to clean (dev or prod) - REQUIRED  
  --dry-run: Show what would be deleted without actually deleting
  --batch-size: Number of documents to process per batch (default: 100)
  --help: Show this help message

Examples:
  # Dry run on dev environment for ananda site
  node web/scripts/cleanup_empty_answers.js --site ananda --env dev --dry-run

  # Actually delete from dev environment
  node web/scripts/cleanup_empty_answers.js --site ananda --env dev

  # Clean prod with custom batch size
  node web/scripts/cleanup_empty_answers.js --site crystal --env prod --batch-size 50
`);
  process.exit(0);
}

if (!options.site) {
  console.error("Error: --site parameter is required");
  console.error("Use --help for usage information");
  process.exit(1);
}

if (!options.env || !["dev", "prod"].includes(options.env)) {
  console.error('Error: --env parameter is required and must be "dev" or "prod"');
  console.error("Use --help for usage information");
  process.exit(1);
}

if (isNaN(options.batchSize) || options.batchSize < 1) {
  console.error("Error: --batch-size must be a positive number");
  process.exit(1);
}

let db;

// Load environment variables from site-specific .env file
function loadEnvironment(site) {
  const projectRoot = path.join(__dirname, "..", "..");
  const envFile = path.join(projectRoot, `.env.${site}`);

  if (!fs.existsSync(envFile)) {
    throw new Error(`Environment file ${envFile} not found`);
  }

  const result = dotenv.config({ path: envFile });
  if (result.error) {
    throw new Error(`Error loading ${envFile}: ${result.error}`);
  }

  console.log(`Loaded environment from ${envFile}`);
}

// Initialize Firebase Admin SDK
function initializeFirebase() {
  if (getApps().length === 0) {
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (typeof serviceAccountJson !== "string") {
      if (serviceAccountJson === undefined) {
        throw new Error("The GOOGLE_APPLICATION_CREDENTIALS environment variable is not set.");
      } else {
        throw new Error("The GOOGLE_APPLICATION_CREDENTIALS environment variable is not a string.");
      }
    }
    const serviceAccount = JSON.parse(serviceAccountJson);

    const app = initializeApp({
      credential: cert(serviceAccount),
    });

    db = getFirestore(app);
  } else {
    db = getFirestore();
  }
}

// Get collection name based on environment
function getAnswersCollectionName(env) {
  return `${env}_chatLogs`;
}

// Check if answer is considered "empty" or problematic
function isEmptyAnswer(answer) {
  if (!answer) return true;
  if (typeof answer !== "string") return true;
  if (answer.trim() === "") return true;
  if (answer.length < 5) return true;
  return false;
}

// Get all documents with empty answers
async function findEmptyAnswerDocuments(collectionName) {
  console.log(`\n🔍 Scanning collection: ${collectionName}`);

  const emptyDocs = [];
  let totalDocs = 0;
  let lastDoc = null;

  while (true) {
    console.log(`  📄 Processing batch (total processed: ${totalDocs})...`);

    let query = db.collection(collectionName).limit(options.batchSize);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    snapshot.forEach((doc) => {
      const data = doc.data();
      totalDocs++;

      if (isEmptyAnswer(data.answer)) {
        emptyDocs.push({
          id: doc.id,
          question: data.question || "[No question]",
          answer: data.answer,
          timestamp: data.timestamp,
          collection: data.collection,
          relatedQuestionsV2: data.relatedQuestionsV2 || [],
        });
      }
    });

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  console.log(`  ✅ Scan complete. Total documents: ${totalDocs}, Empty answers: ${emptyDocs.length}`);
  return emptyDocs;
}

// Find documents that reference the problematic document IDs in their relatedQuestionsV2 arrays
async function findDocumentsWithReferences(collectionName, problemDocIds) {
  console.log(`\n🔗 Finding documents with references to ${problemDocIds.length} problematic documents...`);

  const documentsWithRefs = [];
  let totalChecked = 0;
  let lastDoc = null;

  while (true) {
    console.log(`  📄 Checking batch (total checked: ${totalChecked})...`);

    let query = db.collection(collectionName).limit(options.batchSize);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    snapshot.forEach((doc) => {
      const data = doc.data();
      totalChecked++;

      const relatedQuestions = data.relatedQuestionsV2 || [];
      if (Array.isArray(relatedQuestions) && relatedQuestions.length > 0) {
        const foundRefs = relatedQuestions.filter((rq) => rq.id && problemDocIds.includes(rq.id));

        if (foundRefs.length > 0) {
          documentsWithRefs.push({
            id: doc.id,
            question: data.question || "[No question]",
            referencedIds: foundRefs.map((ref) => ref.id),
            totalRelatedQuestions: relatedQuestions.length,
          });
        }
      }
    });

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  console.log(`  ✅ Reference scan complete. Checked: ${totalChecked}, Found references: ${documentsWithRefs.length}`);
  return documentsWithRefs;
}

// Clean up references from relatedQuestionsV2 arrays
async function cleanupReferences(collectionName, documentsWithRefs, problemDocIds) {
  if (documentsWithRefs.length === 0) {
    console.log("  ℹ️  No references to clean up");
    return;
  }

  console.log(`\n🧹 Cleaning up references in ${documentsWithRefs.length} documents...`);

  const batch = db.batch();
  let operationsInBatch = 0;
  let totalOperations = 0;

  for (const docWithRef of documentsWithRefs) {
    const docRef = db.collection(collectionName).doc(docWithRef.id);
    const docSnapshot = await docRef.get();

    if (docSnapshot.exists) {
      const data = docSnapshot.data();
      const relatedQuestions = data.relatedQuestionsV2 || [];

      // Filter out the problematic references
      const cleanedRelatedQuestions = relatedQuestions.filter((rq) => !rq.id || !problemDocIds.includes(rq.id));

      const removedCount = relatedQuestions.length - cleanedRelatedQuestions.length;

      if (removedCount > 0) {
        console.log(
          `  🔧 ${docWithRef.id}: Removing ${removedCount} references (${relatedQuestions.length} → ${cleanedRelatedQuestions.length})`
        );

        if (!options.dryRun) {
          batch.update(docRef, { relatedQuestionsV2: cleanedRelatedQuestions });
          operationsInBatch++;
          totalOperations++;

          // Commit batch if it gets too large
          if (operationsInBatch >= 450) {
            // Firestore batch limit is 500
            await batch.commit();
            console.log(`    💾 Committed batch of ${operationsInBatch} operations`);
            operationsInBatch = 0;
          }
        }
      }
    }
  }

  // Commit any remaining operations
  if (operationsInBatch > 0 && !options.dryRun) {
    await batch.commit();
    console.log(`    💾 Committed final batch of ${operationsInBatch} operations`);
  }

  if (options.dryRun) {
    console.log(`  🔍 DRY RUN: Would clean references in ${documentsWithRefs.length} documents`);
  } else {
    console.log(`  ✅ Cleaned references in ${totalOperations} documents`);
  }
}

// Delete the problematic documents
async function deleteEmptyAnswerDocuments(collectionName, emptyDocs) {
  if (emptyDocs.length === 0) {
    console.log("  ℹ️  No documents to delete");
    return;
  }

  console.log(`\n🗑️  Deleting ${emptyDocs.length} documents with empty answers...`);

  const batch = db.batch();
  let operationsInBatch = 0;
  let totalDeleted = 0;

  for (const doc of emptyDocs) {
    console.log(`  🗑️  ${doc.id}: "${doc.question?.substring(0, 60)}..." (answer: ${JSON.stringify(doc.answer)})`);

    if (!options.dryRun) {
      const docRef = db.collection(collectionName).doc(doc.id);
      batch.delete(docRef);
      operationsInBatch++;
      totalDeleted++;

      // Commit batch if it gets too large
      if (operationsInBatch >= 450) {
        // Firestore batch limit is 500
        await batch.commit();
        console.log(`    💾 Committed deletion batch of ${operationsInBatch} operations`);
        operationsInBatch = 0;
      }
    }
  }

  // Commit any remaining operations
  if (operationsInBatch > 0 && !options.dryRun) {
    await batch.commit();
    console.log(`    💾 Committed final deletion batch of ${operationsInBatch} operations`);
  }

  if (options.dryRun) {
    console.log(`  🔍 DRY RUN: Would delete ${emptyDocs.length} documents`);
  } else {
    console.log(`  ✅ Deleted ${totalDeleted} documents`);
  }
}

// Main cleanup function
async function runCleanup() {
  try {
    console.log("🚀 Starting Firestore cleanup for empty answers...");
    console.log(`📋 Configuration:`);
    console.log(`   Site: ${options.site}`);
    console.log(`   Environment: ${options.env}`);
    console.log(`   Dry Run: ${options.dryRun ? "YES" : "NO"}`);
    console.log(`   Batch Size: ${options.batchSize}`);

    const collectionName = getAnswersCollectionName(options.env);

    // Step 1: Find all documents with empty answers
    const emptyDocs = await findEmptyAnswerDocuments(collectionName);

    if (emptyDocs.length === 0) {
      console.log("\n✅ No documents with empty answers found. Nothing to clean up!");
      return;
    }

    // Step 2: Extract IDs of problematic documents
    const problemDocIds = emptyDocs.map((doc) => doc.id);

    // Step 3: Find documents that reference these problematic documents
    const documentsWithRefs = await findDocumentsWithReferences(collectionName, problemDocIds);

    console.log("\n📊 Summary:");
    console.log(`   Documents with empty answers: ${emptyDocs.length}`);
    console.log(`   Documents with references to clean: ${documentsWithRefs.length}`);

    if (options.dryRun) {
      console.log("\n🔍 DRY RUN MODE - No changes will be made");
      console.log("\nDocuments that would be deleted:");
      emptyDocs.forEach((doc, index) => {
        console.log(`${index + 1}. ${doc.id}`);
        console.log(`   Question: "${doc.question?.substring(0, 100)}..."`);
        console.log(`   Answer: ${JSON.stringify(doc.answer)}`);
        console.log(`   Collection: ${doc.collection || "N/A"}`);
        console.log("");
      });

      if (documentsWithRefs.length > 0) {
        console.log("Documents with references that would be cleaned:");
        documentsWithRefs.forEach((doc, index) => {
          console.log(`${index + 1}. ${doc.id}`);
          console.log(`   Question: "${doc.question?.substring(0, 100)}..."`);
          console.log(`   Referenced IDs: ${doc.referencedIds.join(", ")}`);
          console.log("");
        });
      }
    } else {
      console.log("\n⚠️  LIVE MODE - Changes will be made to the database");
      console.log("Proceeding in 3 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Step 4: Clean up references first (before deleting the documents)
      await cleanupReferences(collectionName, documentsWithRefs, problemDocIds);

      // Step 5: Delete the problematic documents
      await deleteEmptyAnswerDocuments(collectionName, emptyDocs);
    }

    console.log("\n🎉 Cleanup process completed successfully!");
  } catch (error) {
    console.error("\n❌ Error during cleanup:", error);
    process.exit(1);
  }
}

// Initialize and run
async function main() {
  try {
    loadEnvironment(options.site);
    initializeFirebase();
    await runCleanup();
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

main();
