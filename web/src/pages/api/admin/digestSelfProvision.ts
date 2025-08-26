// API: Daily digest of self-provision attempts. Intended for Vercel Cron (once per day).
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { sendOpsAlert } from "@/utils/server/emailOps";

/**
 * Middleware that allows either JWT authentication or Vercel cron requests
 * @param handler The API route handler to wrap
 * @returns A wrapped handler that checks for either valid JWT or Vercel cron
 */
function withJwtOrCronAuth(handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const userAgent = req.headers["user-agent"] || "";
    const isVercelCron = userAgent.startsWith("vercel-cron/");
    const authHeader = req.headers.authorization || "";

    if (isVercelCron) {
      // Verify that cron requests provide the correct secret
      if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      // Allow authorized Vercel cron requests through
      return handler(req, res);
    } else {
      // For all other requests, require JWT authentication
      return withJwtAuth(handler)(req, res);
    }
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Light rate limit to avoid accidental rapid calls
  const allowed = await genericRateLimiter(req, res, { windowMs: 60 * 1000, max: 3, name: "digest-self-provision" });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  try {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const siteId = process.env.SITE_ID || "default";
    const collection = process.env.NODE_ENV === "production" ? "prod_admin_audit" : "dev_admin_audit";

    // Fetch last 24h self_provision_attempt and user_activation_completed entries
    let selfProvisionSnap, activationSnap;
    try {
      [selfProvisionSnap, activationSnap] = await Promise.all([
        db.collection(collection).where("action", "==", "self_provision_attempt").where("createdAt", ">=", since).get(),
        db
          .collection(collection)
          .where("action", "==", "user_activation_completed")
          .where("createdAt", ">=", since)
          .get(),
      ]);
    } catch (firestoreError: any) {
      // Handle missing Firestore index error
      if (
        firestoreError?.message?.includes("query requires an index") ||
        firestoreError?.message?.includes("index is currently building")
      ) {
        // Extract the Firebase Console URL from the error message if available
        const urlMatch = firestoreError.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
        const indexUrl = urlMatch ? urlMatch[0] : null;

        console.error("Missing Firestore index for digestSelfProvision query", {
          indexUrl: indexUrl || "Check Firebase Console > Firestore > Indexes",
          collection: collection,
          fields: ["action", "createdAt", "__name__"],
          originalError: firestoreError.message,
        });

        const isBuilding = firestoreError?.message?.includes("index is currently building");

        return res.status(500).json({
          error: "Database configuration error",
          message: isBuilding
            ? "Firestore index is currently building for digest audit queries"
            : "Missing required Firestore index for digest audit queries",
          action: isBuilding
            ? "Wait for index to finish building (usually takes a few minutes)"
            : "Create composite indexes: collection=admin_audit, fields=[action,createdAt,__name__] for both self_provision_attempt and user_activation_completed",
          indexUrl: indexUrl || "Check Firebase Console > Firestore > Indexes",
          details: isBuilding
            ? "Index creation is in progress - the cron job will work once building completes"
            : "This is a one-time setup required for the daily digest functionality",
          originalError: firestoreError.message,
        });
      }
      // Re-throw other Firestore errors
      throw firestoreError;
    }

    let activationEmailsSent = 0;
    let activationsCompleted = 0;
    let errors = 0;
    const samples: Array<{
      target?: string;
      outcome?: string;
      firstName?: string;
      lastName?: string;
    }> = [];

    // First pass: count self-provision outcomes (for activation emails sent)
    const emailsToLookup: string[] = [];
    selfProvisionSnap.forEach((doc) => {
      const data = doc.data() as any;
      const outcome = data?.details?.outcome as string | undefined;

      if (outcome === "created_pending_user") activationEmailsSent++;
      else if (outcome === "server_error") errors++;
      // Skip resent_pending_activation and invalid_password entries entirely
    });

    // Second pass: count activation completions and collect samples
    activationSnap.forEach((doc) => {
      const data = doc.data() as any;
      const outcome = data?.details?.outcome as string | undefined;
      const email = data?.target as string | undefined;

      if (outcome === "activation_completed") {
        activationsCompleted++;
        if (samples.length < 10) {
          samples.push({ target: email, outcome });
          if (email) {
            emailsToLookup.push(email);
          }
        }
      }
    });

    // Third pass: fetch actual user data for names only (not status)
    const userDataMap = new Map<string, { firstName?: string; lastName?: string }>();
    if (emailsToLookup.length > 0) {
      try {
        const userCollection = process.env.NODE_ENV === "production" ? "prod_users" : "dev_users";
        const userQueries = emailsToLookup.map((email) =>
          db!.collection(userCollection).where("email", "==", email).limit(1).get()
        );

        const userResults = await Promise.all(userQueries);
        userResults.forEach((userSnap, index) => {
          if (!userSnap.empty) {
            const userData = userSnap.docs[0].data();
            userDataMap.set(emailsToLookup[index], {
              firstName: userData.firstName,
              lastName: userData.lastName,
              // Don't include inviteStatus - use audit entry outcome instead
            });
          }
        });
      } catch (userFetchError) {
        console.warn("Failed to fetch user data for digest:", userFetchError);
      }
    }

    // Enrich samples with actual user data (names only)
    samples.forEach((sample) => {
      if (sample.target && userDataMap.has(sample.target)) {
        const userData = userDataMap.get(sample.target);
        sample.firstName = userData?.firstName;
        sample.lastName = userData?.lastName;
        // Don't set inviteStatus - use audit entry outcome instead
      }
    });

    // Format samples in a user-friendly way
    const formatSamples = (
      samples: Array<{
        target?: string;
        outcome?: string;
        firstName?: string;
        lastName?: string;
      }>
    ) => {
      if (samples.length === 0) return "No activity in the last 24 hours.";

      return samples
        .map((sample, index) => {
          const email = sample.target || "unknown@email.com";
          const outcome = sample.outcome || "unknown";

          // Use real name if available, otherwise fall back to email prefix
          const fullName =
            sample.firstName && sample.lastName
              ? `${sample.firstName} ${sample.lastName}`
              : sample.firstName || email.split("@")[0];
          const displayName = fullName;

          // Always use audit entry outcome, not current user status
          const statusText =
            {
              activation_completed: "Account activated",
              server_error: "Server error occurred",
            }[outcome] || outcome;

          return `${index + 1}. ${displayName} (${email}) - ${statusText}`;
        })
        .join("\n");
    };

    const body = [
      `Self-provision digest for site ${siteId} (last 24h)`,
      ``,
      `SUMMARY:`,
      `• Activations completed: ${activationsCompleted}`,
      `• Activation emails sent: ${activationEmailsSent}`,
      `• Server errors: ${errors}`,
      ``,
      `ACTIVITY DETAILS:`,
      formatSamples(samples),
    ].join("\n");

    // Create subject line with error counts
    const subjectParts = [];
    if (errors > 0) subjectParts.push(`${errors} error${errors > 1 ? "s" : ""}`);

    const subject = `User activation digest: ${activationsCompleted} activated, ${errors} errors`;

    await sendOpsAlert(subject, body);
    return res.status(200).json({ ok: true, counts: { activationsCompleted, activationEmailsSent, errors }, samples });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to build digest" });
  }
}

// Apply API middleware, skipping its default auth check and relying solely on withJwtOrCronAuth
export default withApiMiddleware(withJwtOrCronAuth(handler), {
  skipAuth: true,
});
