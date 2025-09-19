#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * Test Script: Add Test Users to Development Database
 *
 * This script adds 25 test users to the development database for testing
 * the admin user management interface, particularly pagination functionality.
 *
 * Usage:
 *   cd web && node scripts/add-test-users.cjs --site ananda --env dev
 *
 * Features:
 * - Follows established site-specific environment loading pattern
 * - Creates realistic test user data with varied activation states
 * - Includes proper error handling and progress reporting
 * - Dry-run mode for testing without actual database changes
 */

const path = require("path");
const dotenv = require("dotenv");
const firebase = require("firebase-admin");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

// Site-specific environment loading
function loadEnvironmentForSite(site) {
  const envPath = path.join(process.cwd(), "..", `.env.${site}`);

  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error(`Failed to load environment file: ${envPath}`);
    process.exit(1);
  }

  console.log(`✅ Loaded environment from: ${envPath}`);
}

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  let site = "";
  let env = "";
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--site" && i + 1 < args.length) {
      site = args[i + 1];
      i++;
    } else if (args[i] === "--env" && i + 1 < args.length) {
      env = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  if (!site || !env) {
    console.error("Usage: cd web && node scripts/add-test-users.cjs --site <site> --env <env> [--dry-run]");
    console.error("Example: cd web && node scripts/add-test-users.cjs --site ananda --env dev --dry-run");
    process.exit(1);
  }

  return { site, env, dryRun };
}

// Generate test user data with randomized emails
function generateTestUsers() {
  const firstNames = [
    "Alice",
    "Bob",
    "Carol",
    "David",
    "Emma",
    "Frank",
    "Grace",
    "Henry",
    "Iris",
    "Jack",
    "Kate",
    "Liam",
    "Maya",
    "Noah",
    "Olivia",
    "Paul",
    "Quinn",
    "Ruby",
    "Sam",
    "Tara",
    "Uma",
    "Victor",
    "Wendy",
    "Xavier",
    "Yara",
    "Zoe",
    "Alex",
    "Blake",
    "Casey",
    "Drew",
    "Emery",
    "Finley",
    "Gray",
    "Harper",
    "Indigo",
    "Jordan",
    "Kai",
    "Lane",
    "Morgan",
    "Noel",
    "Ocean",
    "Parker",
    "Quincy",
    "River",
    "Sage",
    "Taylor",
    "Unity",
    "Vale",
    "Winter",
    "Zara",
  ];

  const lastNames = [
    "Anderson",
    "Brown",
    "Chen",
    "Davis",
    "Evans",
    "Foster",
    "Garcia",
    "Harris",
    "Johnson",
    "Kumar",
    "Lee",
    "Miller",
    "Nelson",
    "O'Connor",
    "Patel",
    "Quinn",
    "Rodriguez",
    "Smith",
    "Taylor",
    "Upton",
    "Valdez",
    "Wilson",
    "Xavier",
    "Young",
    "Zhang",
    "Adams",
    "Baker",
    "Clark",
    "Diaz",
    "Ellis",
    "Fisher",
    "Green",
    "Hall",
    "Ivanov",
    "Jackson",
    "King",
    "Lopez",
    "Moore",
    "Nguyen",
    "Oliver",
    "Perry",
    "Queen",
    "Roberts",
    "Stone",
    "Turner",
    "Underwood",
    "Vega",
    "White",
    "Xu",
    "Yang",
  ];

  const domains = ["test.com", "example.org", "demo.net", "sample.io", "mock.dev", "testmail.com", "devtest.org"];

  // Create a timestamp suffix to ensure uniqueness
  const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp

  return Array.from({ length: 25 }, (_, i) => {
    // Randomize name selection to avoid same combinations
    const firstNameIndex = Math.floor(Math.random() * firstNames.length);
    const lastNameIndex = Math.floor(Math.random() * lastNames.length);
    const domainIndex = Math.floor(Math.random() * domains.length);

    const firstName = firstNames[firstNameIndex];
    const lastName = lastNames[lastNameIndex];
    const domain = domains[domainIndex];

    // Add timestamp and random number to ensure uniqueness
    const randomSuffix = Math.floor(Math.random() * 1000);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${timestamp}.${randomSuffix}@${domain}`;

    // All users should be activated/accepted for testing active users functionality
    const status = "accepted";
    const role = i < 20 ? "user" : i < 24 ? "admin" : "superuser";

    return {
      email,
      firstName,
      lastName,
      role,
      status,
    };
  });
}

// Generate invite token and hash
async function generateInviteData() {
  const token = crypto.randomBytes(16).toString("hex");
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  const tokenHash = await bcrypt.hash(token, saltRounds);
  return { token, tokenHash };
}

// Get invite expiry date (7 days from now)
function getInviteExpiryDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

// Initialize Firebase
function initializeFirebase() {
  try {
    // Check if we have GOOGLE_APPLICATION_CREDENTIALS
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log("🔑 Using GOOGLE_APPLICATION_CREDENTIALS for Firebase authentication");

      // Check if GOOGLE_APPLICATION_CREDENTIALS is JSON content or file path
      let credential;
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS.startsWith("{")) {
        // It's JSON content, parse it directly
        console.log("📄 GOOGLE_APPLICATION_CREDENTIALS contains JSON content");
        const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        credential = firebase.credential.cert(serviceAccount);
      } else {
        // It's a file path, let Firebase handle it automatically
        console.log("📁 GOOGLE_APPLICATION_CREDENTIALS points to file path");
        credential = firebase.credential.applicationDefault();
      }

      firebase.initializeApp({
        credential: credential,
        projectId: process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
      });
    } else if (process.env.FIRESTORE_PRIVATE_KEY) {
      // Fallback to individual environment variables
      console.log("🔑 Using individual environment variables for Firebase authentication");
      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIRESTORE_PROJECT_ID,
        private_key_id: process.env.FIRESTORE_PRIVATE_KEY_ID,
        private_key: process.env.FIRESTORE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        client_email: process.env.FIRESTORE_CLIENT_EMAIL,
        client_id: process.env.FIRESTORE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIRESTORE_CLIENT_X509_CERT_URL,
      };

      firebase.initializeApp({
        credential: firebase.credential.cert(serviceAccount),
        projectId: process.env.FIRESTORE_PROJECT_ID,
      });
    } else {
      console.error("❌ Missing Firebase credentials. Please set either:");
      console.error("   - GOOGLE_APPLICATION_CREDENTIALS environment variable, or");
      console.error("   - Individual Firestore environment variables (FIRESTORE_PRIVATE_KEY, etc.)");
      process.exit(1);
    }

    console.log("✅ Firebase initialized successfully");
    return firebase.firestore();
  } catch (error) {
    console.error("❌ Failed to initialize Firebase:", error);
    process.exit(1);
  }
}

// Get users collection name based on environment
function getUsersCollectionName(env) {
  return `${env}_users`;
}

// Main execution function
async function main() {
  const { site, env, dryRun } = parseArguments();

  console.log(`🚀 Adding test users to ${site} site (${env} environment)`);
  if (dryRun) {
    console.log("🧪 DRY RUN MODE - No actual database changes will be made");
  }

  // Load environment
  loadEnvironmentForSite(site);

  // Initialize Firebase
  const db = initializeFirebase();
  const usersCollection = getUsersCollectionName(env);

  console.log(`📊 Using collection: ${usersCollection}`);

  // Generate test users
  const testUsers = generateTestUsers();
  console.log(`👥 Generated ${testUsers.length} test users`);

  if (dryRun) {
    console.log("\n📋 Test users that would be created:");
    testUsers.forEach((user, i) => {
      console.log(`  ${i + 1}. ${user.firstName} ${user.lastName} (${user.email}) - ${user.role} - ${user.status}`);
    });
    console.log("\n✅ Dry run completed - no database changes made");
    process.exit(0);
  }

  // Add users to database
  let successCount = 0;
  let errorCount = 0;
  const now = firebase.firestore.Timestamp.now();

  console.log("\n📝 Adding users to database...");

  for (let index = 0; index < testUsers.length; index++) {
    const user = testUsers[index];
    try {
      const userDoc = db.collection(usersCollection).doc(user.email.toLowerCase());

      // Check if user already exists
      const existing = await userDoc.get();
      if (existing.exists) {
        console.log(`⚠️  User ${user.email} already exists, skipping`);
        continue;
      }

      let userData = {
        // Note: email is stored as document ID, not as a field
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        entitlements: { basic: true },
        createdAt: now,
        updatedAt: now,
      };

      if (user.status === "pending") {
        const { tokenHash } = await generateInviteData();
        userData = {
          ...userData,
          inviteStatus: "pending",
          inviteTokenHash: tokenHash,
          inviteExpiresAt: firebase.firestore.Timestamp.fromDate(getInviteExpiryDate()),
        };
      } else {
        userData = {
          ...userData,
          inviteStatus: "accepted",
          verifiedAt: now,
          lastLoginAt: now,
          uuid: crypto.randomUUID(),
        };
      }

      await userDoc.set(userData);
      successCount++;
      console.log(`✅ Added user ${index + 1}/25: ${user.email} (${user.status})`);
    } catch (error) {
      errorCount++;
      console.error(`❌ Failed to add user ${user.email}:`, error);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Successfully added: ${successCount} users`);
  console.log(`  ❌ Errors: ${errorCount} users`);
  console.log(`  📍 Collection: ${usersCollection}`);

  if (successCount > 0) {
    console.log(`\n🎉 Test users added successfully! You can now test the admin interface.`);
    console.log(`   Visit: http://localhost:3000/admin/users`);
    console.log(`   Pending users: http://localhost:3000/admin/users/pending`);
  }

  process.exit(0);
}

// Run the script
main().catch((error) => {
  console.error("❌ Script failed:", error);
  process.exit(1);
});
