import { fileURLToPath } from "url";
import * as path from "path";
import * as dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvironmentForSite(site: string) {
  const envPath = path.join(__dirname, "..", "..", `.env.${site}`);
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error(`Failed to load environment from ${envPath}:`, result.error.message);
    process.exit(1);
  }
  console.log(`Loaded environment from: ${envPath}`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const siteIndex = args.indexOf("--site");
const envIndex = args.indexOf("--env");

if (siteIndex === -1 || envIndex === -1) {
  console.error("Usage: npx tsx scripts/check-chats.ts --site <site> --env <env>");
  console.error("Example: npx tsx scripts/check-chats.ts --site ananda --env dev");
  process.exit(1);
}

const site = args[siteIndex + 1];
const env = args[envIndex + 1];

if (!site || !env) {
  console.error("Please provide both --site and --env arguments");
  process.exit(1);
}

// Load environment
loadEnvironmentForSite(site);

// Import Firebase after environment is loaded
import firebase from "firebase-admin";

// Initialize Firebase if not already initialized
if (!firebase.apps.length) {
  const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountJson) {
    console.error("GOOGLE_APPLICATION_CREDENTIALS environment variable not set");
    process.exit(1);
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
  });
}

const db = firebase.firestore();

async function checkChats() {
  try {
    const collection = env === "prod" ? "prod_chatLogs" : "dev_chatLogs";
    console.log(`Checking collection: ${collection}`);

    const snapshot = await db.collection(collection).limit(5).get();
    console.log(`Found ${snapshot.size} documents in ${collection}`);

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      console.log(`- ${doc.id}: question=${data.question?.substring(0, 50)}..., convId=${data.convId || "missing"}`);
    });
  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

checkChats();
