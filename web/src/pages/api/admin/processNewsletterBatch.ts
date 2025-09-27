import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import path from "path";
import Email from "email-templates";
import { marked } from "marked";
import { db } from "@/services/firebase";
import { getNewslettersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreQueryGet, firestoreUpdate } from "@/utils/server/firestoreRetryUtils";
import { requireSuperuserRole } from "@/utils/server/authz";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { sendEmail } from "@/utils/server/emailUtils";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import firebase from "firebase-admin";

interface BatchRequest {
  newsletterId: string;
  batchSize?: number;
}

async function convertMarkdownToHtml(markdownContent: string): Promise<string> {
  try {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
    const result = await marked(markdownContent);
    return typeof result === "string" ? result : markdownContent.replace(/\n/g, "<br>");
  } catch (error) {
    console.error("Markdown parsing error:", error);
    return markdownContent.replace(/\n/g, "<br>");
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    requireSuperuserRole(req);

    const { newsletterId, batchSize = 50 }: BatchRequest = req.body;
    if (!newsletterId) {
      return res.status(400).json({ error: "newsletterId required" });
    }

    // Fetch pending/failed items (attempts < 3)
    const queueItemsQuery = db
      .collection(`${getNewslettersCollectionName()}/${newsletterId}/queueItems`)
      .where("status", "in", ["pending", "failed"])
      .where("attempts", "<", 3)
      .orderBy("createdAt")
      .limit(batchSize);

    const itemsSnapshot = await firestoreQueryGet(queueItemsQuery, "get queue batch", "newsletter process");

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    // Load site config once
    const siteConfig = await loadSiteConfig();
    const siteName = siteConfig?.name || "Ananda Library";
    const jwtSecret = process.env.SECURE_TOKEN;
    const fromEmail = process.env.CONTACT_EMAIL;

    if (!jwtSecret || !fromEmail) {
      return res.status(500).json({ error: "Configuration missing" });
    }

    // Initialize email template
    const email = new Email({
      juice: true,
      views: { root: path.join(process.cwd(), "emails") },
      send: false,
    });

    for (const doc of itemsSnapshot.docs) {
      const data = doc.data();
      try {
        // Generate unsubscribe token
        const unsubscribeToken = jwt.sign({ email: data.email, purpose: "newsletter_unsubscribe" }, jwtSecret, {
          expiresIn: "1y",
        });
        const unsubscribeUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/unsubscribe?token=${unsubscribeToken}`;

        // Personalization
        const firstName = data.firstName;
        const lastName = data.lastName;
        let userName = "Friend";
        if (firstName && lastName) {
          userName = `${firstName} ${lastName}`;
        } else if (firstName) {
          userName = firstName;
        }

        // Convert content
        const htmlContent = await convertMarkdownToHtml(data.content);

        const html = await email.render("newsletter", {
          subject: data.subject,
          siteName,
          userName,
          content: htmlContent,
          ctaUrl: data.ctaUrl,
          ctaText: data.ctaText,
          unsubscribeUrl,
        });

        // Send
        const emailSent = await sendEmail({
          to: data.email,
          subject: data.subject,
          html,
          from: fromEmail,
        });

        if (emailSent) {
          await firestoreUpdate(doc.ref, { status: "sent", updatedAt: firebase.firestore.Timestamp.now() });
          sent++;
        } else {
          throw new Error("Send failed");
        }
      } catch (error: any) {
        const attempts = data.attempts + 1;
        await firestoreUpdate(doc.ref, {
          status: attempts < 3 ? "failed" : "permanently_failed",
          error: error.message,
          attempts,
          updatedAt: firebase.firestore.Timestamp.now(),
        });
        failed++;
        errors.push(`${data.email}: ${error.message}`);
      }
    }

    // Update metadata
    const metaRef = db.collection(getNewslettersCollectionName()).doc(newsletterId);
    await firestoreUpdate(metaRef, {
      sentCount: firebase.firestore.FieldValue.increment(sent),
      failedCount: firebase.firestore.FieldValue.increment(failed),
      status: itemsSnapshot.size === 0 ? "completed" : "in_progress",
    });

    // Get remaining
    const remainingQuery = db
      .collection(`${getNewslettersCollectionName()}/${newsletterId}/queueItems`)
      .where("status", "==", "pending");
    const remainingSnapshot = await firestoreQueryGet(remainingQuery, "get remaining count", "newsletter process");
    const remaining = remainingSnapshot.size;

    return res.status(200).json({ sent, failed, remaining, errors });
  } catch (error: any) {
    console.error("Batch processing error:", error);
    return res.status(500).json({ error: "Batch processing failed", details: error.message });
  }
}

export default withJwtAuth(handler);
