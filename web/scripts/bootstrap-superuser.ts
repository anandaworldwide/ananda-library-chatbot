/*
Interactive bootstrap script to create/update a superuser in Firestore.

Usage:
  - With existing env in shell (GOOGLE_APPLICATION_CREDENTIALS, etc.):
      npx tsx scripts/bootstrap-superuser.ts
  - Or load a site env file first by passing --site:
      npx tsx scripts/bootstrap-superuser.ts --site ananda

The script will prompt for environment (dev/prod) and the email address.
It will set role=superuser and inviteStatus=accepted for that user in
the appropriate collection: dev_users or prod_users.
*/

import readline from "readline";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import firebase from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvironmentDirectly(site: string) {
  const projectRoot = path.join(__dirname, "..", "..");
  const envFile = path.join(projectRoot, `.env.${site}`);
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
    console.log(`Loaded environment from ${envFile}`);
  } else {
    console.warn(`Warning: ${envFile} not found. Using current process env.`);
  }
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function ensureFirebase(): Promise<firebase.firestore.Firestore> {
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!creds) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS env var is not set. Provide Firebase service account JSON string or file path."
    );
  }

  let json: Record<string, any>;
  try {
    // Try parsing as JSON first
    json = JSON.parse(creds);
  } catch (e) {
    // If parsing fails, try treating as file path
    if (fs.existsSync(creds)) {
      const fileContents = fs.readFileSync(creds, "utf8");
      json = JSON.parse(fileContents);
    } else {
      throw new Error(`Invalid GOOGLE_APPLICATION_CREDENTIALS: not valid JSON and file does not exist: ${creds}`);
    }
  }

  const app = firebase.initializeApp({ credential: firebase.credential.cert(json) });
  return firebase.firestore(app);
}

function getUsersCollectionName(targetEnv: "dev" | "prod"): string {
  return `${targetEnv}_users`;
}

async function run() {
  // Basic CLI arg parsing
  const argv = process.argv.slice(2);
  const getArgVal = (name: string): string | undefined => {
    const withEq = argv.find((a) => a.startsWith(`--${name}=`));
    if (withEq) return withEq.split("=")[1];
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0) return argv[idx + 1];
    return undefined;
  };
  const hasFlag = (name: string) => argv.includes(`--${name}`) || argv.includes(`-${name}`);

  // Handle help early and exit
  if (hasFlag("help") || hasFlag("h")) {
    console.log(
      `\nUsage:\n  npx tsx scripts/bootstrap-superuser.ts --site <site> [--env <dev|prod>] [--email <email>] [--help]\n\nOptions:\n  --site <site>     REQUIRED: Load environment from project root .env.<site>\n  --env <dev|prod>  Target collection by environment (dev_users or prod_users)\n  --email <email>   Email to create or elevate to superuser (non-interactive)\n  -h, --help        Show this help message\n\nExamples:\n  npx tsx scripts/bootstrap-superuser.ts --site ananda\n  npx tsx scripts/bootstrap-superuser.ts --site ananda --env prod --email alice@example.com\n`
    );
    return;
  }

  // Require --site argument
  const site = getArgVal("site");
  if (!site) {
    console.error("Error: --site argument is required. Use --site ananda, --site crystal, etc.");
    process.exit(1);
  }
  loadEnvironmentDirectly(site);

  // Determine environment (flag overrides prompt)
  let env = getArgVal("env");
  if (!env) {
    env = await ask("Environment (dev/prod) [dev]: ");
  }
  if (env === "") env = "dev";
  if (env !== "dev" && env !== "prod") {
    console.error("Invalid environment. Use 'dev' or 'prod'.");
    process.exit(1);
  }
  const targetEnv = env as "dev" | "prod";

  // Determine email (flag overrides prompt)
  let email = getArgVal("email")?.toLowerCase();
  if (!email) {
    email = (await ask("Superuser email: ")).toLowerCase();
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Invalid email.");
    process.exit(1);
  }

  // Init Firebase
  const db = await ensureFirebase();
  const usersCol = getUsersCollectionName(targetEnv);
  const ref = db.collection(usersCol).doc(email);
  const snap = await ref.get();
  const now = firebase.firestore.Timestamp.now();

  if (!snap.exists) {
    await ref.set({
      email,
      role: "superuser",
      entitlements: { basic: true },
      inviteStatus: "accepted",
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Created superuser: ${email} in ${usersCol}`);
  } else {
    await ref.set({ role: "superuser", inviteStatus: "accepted", verifiedAt: now, updatedAt: now }, { merge: true });
    console.log(`Updated superuser: ${email} in ${usersCol}`);
  }

  console.log("Done.");

  // Explicitly exit to avoid hanging on Firebase connections
  process.exit(0);
}

run().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
