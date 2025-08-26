/**
 * Migration script to generate AI titles for recent conversations
 * Finds conversations from the last 60 days without titles and generates AI titles for them
 *
 * Usage: npx tsx scripts/generate-titles.ts --site <site-name> --env <environment> [--batch-size <size>] [--dry-run]
 * Example: npx tsx scripts/generate-titles.ts --site ananda --env dev --batch-size 50
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

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
const batchSizeIndex = args.indexOf("--batch-size");
const dryRunIndex = args.indexOf("--dry-run");

if (siteIndex === -1 || siteIndex + 1 >= args.length) {
  console.error(
    "Usage: npx tsx scripts/generate-titles.ts --site <site-name> --env <environment> [--batch-size <size>] [--dry-run]"
  );
  console.error("Example: npx tsx scripts/generate-titles.ts --site ananda --env dev --batch-size 50");
  process.exit(1);
}

const site = args[siteIndex + 1];
const environment = envIndex !== -1 && envIndex + 1 < args.length ? args[envIndex + 1] : "dev";
const batchSize =
  batchSizeIndex !== -1 && batchSizeIndex + 1 < args.length ? parseInt(args[batchSizeIndex + 1], 10) : 100;
const isDryRun = dryRunIndex !== -1;

// Validate batch size
if (isNaN(batchSize) || batchSize < 1 || batchSize > 500) {
  console.error("Batch size must be a number between 1 and 500");
  process.exit(1);
}

// Load site-specific environment
loadEnvironmentForSite(site);

// Now import Firebase and other dependencies after environment is loaded
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

/**
 * Generates a concise 4-word title for a question using AI
 * Only generates titles for questions longer than 5 words
 */
async function generateAITitle(question: string): Promise<string | null> {
  try {
    const words = question.trim().split(/\s+/);

    // If question is 5 words or less, don't generate AI title - use exact text
    if (words.length <= 5) {
      return null; // This will cause fallback to exact question text
    }

    // Import ChatOpenAI dynamically to avoid loading before environment is set
    const { ChatOpenAI } = await import("@langchain/openai");

    // Use fast model for title generation
    const model = new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      temperature: 0.1,
      maxTokens: 20, // Keep it short
      timeout: 10000, // 10 second timeout
    });

    const prompt = `Generate a concise four-word title for this question: "${question}"

Requirements:
- Exactly 4 words
- Capture the main topic
- No punctuation
- Title case
- IMPORTANT: Generate the title in the SAME LANGUAGE as the original question

Examples:
Question: "How do I meditate properly?"
Title: "Proper Meditation Technique Guide"

Question: "What are Yogananda's teachings about love?"
Title: "Yogananda Love Teaching Wisdom"

Question: "¿Cuáles son los principios de meditación?"
Title: "Principios Básicos Meditación Espiritual"

Question: "Comment méditer correctement selon Yogananda?"
Title: "Méditation Correcte Selon Yogananda"

Title:`;

    const response = await model.invoke(prompt);
    const title = response.content?.toString()?.trim();

    if (title && title.split(" ").length <= 6) {
      // Allow some flexibility
      return title;
    }

    return null;
  } catch (error) {
    console.error("AI title generation failed:", error);
    return null;
  }
}

/**
 * Creates a fallback title by truncating the question
 */
function createFallbackTitle(question: string): string {
  const words = question.trim().split(/\s+/);

  // If 5 words or less, use the full question
  if (words.length <= 5) {
    return question;
  }

  // Otherwise, truncate to first 4 words and add ellipsis
  const truncated = words.slice(0, 4).join(" ");

  return truncated + (words.length > 4 ? "..." : "");
}

/**
 * Generates a title for a conversation
 */
async function generateTitle(question: string): Promise<string> {
  const aiTitle = await generateAITitle(question);
  return aiTitle || createFallbackTitle(question);
}

async function generateTitlesForRecentConversations() {
  console.log(
    `Starting title generation for recent conversations (last 60 days) for site: ${site}, environment: ${environment}`
  );
  console.log(`Batch size: ${batchSize}, Dry run: ${isDryRun}`);

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

    // Calculate date 60 days ago
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Get documents from the last 60 days that don't have a title field or have null/empty title
    // We filter by timestamp first to reduce the dataset, then filter client-side for missing titles
    console.log("Fetching documents from the last 60 days without titles...");
    console.log(`Looking for documents created after: ${sixtyDaysAgo.toISOString()}`);

    const snapshot = await answersRef.where("timestamp", ">=", sixtyDaysAgo).get();

    const docsWithoutTitle = snapshot.docs.filter((doc) => {
      const data = doc.data();
      return !data.title || data.title === null || data.title.trim() === "";
    });

    console.log(
      `Found ${docsWithoutTitle.length} documents without titles out of ${snapshot.docs.length} total documents from the last 60 days`
    );

    if (docsWithoutTitle.length === 0) {
      console.log("No documents need title generation. All documents already have titles.");
      return;
    }

    if (isDryRun) {
      console.log("DRY RUN MODE - No changes will be made");
      console.log("Sample documents that would be processed:");

      // Show first 5 documents as examples
      const sampleDocs = docsWithoutTitle.slice(0, 5);
      for (const doc of sampleDocs) {
        const data = doc.data();
        const question = data.question || "No question found";
        const generatedTitle = await generateTitle(question);
        console.log(`  - Doc ID: ${doc.id}`);
        console.log(`    Question: ${question.substring(0, 100)}${question.length > 100 ? "..." : ""}`);
        console.log(`    Generated Title: "${generatedTitle}"`);
        console.log("");
      }

      console.log(`Total documents that would be processed: ${docsWithoutTitle.length}`);
      return;
    }

    // Process documents in batches (Firestore batch limit is 500)
    const maxBatchSize = Math.min(batchSize, 500);
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < docsWithoutTitle.length; i += maxBatchSize) {
      const batch = db.batch();
      const batchDocs = docsWithoutTitle.slice(i, i + maxBatchSize);
      const batchTitles: { docId: string; title: string; question: string }[] = [];

      console.log(
        `\nProcessing batch ${Math.floor(i / maxBatchSize) + 1}/${Math.ceil(docsWithoutTitle.length / maxBatchSize)}...`
      );

      // Generate titles for all documents in this batch
      for (const doc of batchDocs) {
        try {
          const data = doc.data();
          const question = data.question || "";

          if (!question.trim()) {
            console.warn(`Skipping document ${doc.id} - no question found`);
            errorCount++;
            continue;
          }

          const title = await generateTitle(question);
          batchTitles.push({ docId: doc.id, title, question });

          // Add to Firestore batch
          batch.update(doc.ref, { title });

          console.log(`  Generated title for ${doc.id}: "${title}"`);
        } catch (error) {
          console.error(`  Error generating title for ${doc.id}:`, error);
          errorCount++;
        }
      }

      // Commit the batch
      if (batchTitles.length > 0) {
        try {
          await batch.commit();
          successCount += batchTitles.length;
          console.log(`  ✅ Successfully updated ${batchTitles.length} documents in this batch`);
        } catch (error) {
          console.error(`  ❌ Failed to commit batch:`, error);
          errorCount += batchTitles.length;
        }
      }

      processedCount += batchDocs.length;
      console.log(`Progress: ${processedCount}/${docsWithoutTitle.length} documents processed`);

      // Add a small delay between batches to avoid rate limiting
      if (i + maxBatchSize < docsWithoutTitle.length) {
        console.log("Waiting 1 second before next batch...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n✅ Title generation completed!`);
    console.log(`Successfully generated titles for ${successCount} documents`);
    console.log(`Errors encountered: ${errorCount}`);
    console.log(`Total processed: ${processedCount}`);

    // Verify the migration
    console.log("\nVerifying results...");
    const verifySnapshot = await answersRef.get();
    const remainingDocsWithoutTitle = verifySnapshot.docs.filter((doc) => {
      const data = doc.data();
      return !data.title || data.title === null || data.title.trim() === "";
    });

    if (remainingDocsWithoutTitle.length === 0) {
      console.log("✅ Verification passed: All documents now have titles");
    } else {
      console.warn(`⚠️  Warning: ${remainingDocsWithoutTitle.length} documents still missing titles`);

      // Show a few examples of documents still missing titles
      if (remainingDocsWithoutTitle.length <= 5) {
        console.log("Documents still missing titles:");
        remainingDocsWithoutTitle.forEach((doc) => {
          const data = doc.data();
          console.log(`  - ${doc.id}: "${(data.question || "No question").substring(0, 100)}..."`);
        });
      }
    }
  } catch (error) {
    console.error("❌ Title generation failed:", error);
    process.exit(1);
  }
}

// Run the title generation
generateTitlesForRecentConversations()
  .then(() => {
    console.log("Title generation script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Title generation script failed:", error);
    process.exit(1);
  });
