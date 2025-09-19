import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import path from "path";
import Email from "email-templates";
import { marked } from "marked";
import { db } from "@/services/firebase";
import { getUsersCollectionName, getNewslettersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreQueryGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { requireAdminRole } from "@/utils/server/authz";
import { withJwtAuth, getTokenFromRequest } from "@/utils/server/jwtUtils";
import { sendEmail } from "@/utils/server/emailUtils";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import firebase from "firebase-admin";

interface NewsletterRequest {
  subject: string;
  content: string;
  ctaUrl?: string;
  ctaText?: string;
  includeRoles?: {
    users: boolean;
    admins: boolean;
    superusers: boolean;
  };
}

async function convertMarkdownToHtml(markdownContent: string): Promise<string> {
  try {
    // Configure marked for safe HTML generation
    marked.setOptions({
      breaks: true, // Convert line breaks to <br>
      gfm: true, // Enable GitHub Flavored Markdown
    });

    // Convert Markdown to HTML
    const result = await marked(markdownContent);
    return typeof result === "string" ? result : markdownContent.replace(/\n/g, "<br>");
  } catch (error) {
    console.error("Markdown parsing error:", error);
    // Fallback to plain text with line breaks
    return markdownContent.replace(/\n/g, "<br>");
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limiting
  const allowed = await genericRateLimiter(req, res, {
    name: "sendNewsletter",
    max: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });
  if (!allowed) return;

  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    // Validate admin role
    requireAdminRole(req);

    // Get user info from JWT token
    const tokenPayload = getTokenFromRequest(req);
    const adminEmail = tokenPayload.email || "unknown";

    // Validate request body
    const { subject, content, ctaUrl, ctaText, includeRoles }: NewsletterRequest = req.body;

    if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
      return res.status(400).json({ error: "Subject is required" });
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Content is required" });
    }

    if (subject.length > 200) {
      return res.status(400).json({ error: "Subject too long (max 200 characters)" });
    }

    if (content.length > 50000) {
      return res.status(400).json({ error: "Content too long (max 50,000 characters)" });
    }

    // Validate optional CTA fields
    if (ctaUrl && (!ctaText || ctaText.trim().length === 0)) {
      return res.status(400).json({ error: "CTA text is required when CTA URL is provided" });
    }

    if (ctaText && (!ctaUrl || ctaUrl.trim().length === 0)) {
      return res.status(400).json({ error: "CTA URL is required when CTA text is provided" });
    }

    // Validate role selection (default to all roles if not provided)
    const roleSelection = includeRoles || { users: true, admins: true, superusers: true };

    if (!roleSelection.users && !roleSelection.admins && !roleSelection.superusers) {
      return res.status(400).json({ error: "At least one user role must be selected" });
    }

    // Load site configuration
    const siteConfig = await loadSiteConfig();
    const siteName = siteConfig?.name || "Ananda Library";

    // Get subscribed users based on role selection
    const usersCol = getUsersCollectionName();

    // Build array of allowed roles
    const allowedRoles: string[] = [];
    if (roleSelection.users) allowedRoles.push("user");
    if (roleSelection.admins) allowedRoles.push("admin");
    if (roleSelection.superusers) allowedRoles.push("superuser");

    // Query users with selected roles
    const subscribedUsersQuery = db
      .collection(usersCol)
      .where("newsletterSubscribed", "==", true)
      .where("inviteStatus", "==", "accepted") // Only send to fully activated users
      .where("role", "in", allowedRoles); // Filter by selected roles

    const subscribedUsersSnapshot = await firestoreQueryGet(
      subscribedUsersQuery,
      "get subscribed users by role",
      "newsletter send"
    );

    if (subscribedUsersSnapshot.empty) {
      const selectedRoleNames = [];
      if (roleSelection.users) selectedRoleNames.push("Users");
      if (roleSelection.admins) selectedRoleNames.push("Admins");
      if (roleSelection.superusers) selectedRoleNames.push("Super Users");

      return res.status(400).json({
        error: "No newsletter subscribers found",
        details: `There are currently no ${selectedRoleNames.join(", ")} with newsletter subscriptions enabled. You can enable newsletter subscriptions for users in the admin user management page, or run the newsletter opt-in migration script to enable it for all existing users.`,
      });
    }

    const subscribedUsers = subscribedUsersSnapshot.docs.map((doc: firebase.firestore.QueryDocumentSnapshot) => ({
      email: doc.id,
      data: doc.data(),
    }));

    console.log(`Sending newsletter to ${subscribedUsers.length} subscribers`);

    // Initialize email template engine
    const email = new Email({
      juice: true,
      views: { root: path.join(process.cwd(), "emails") },
      send: false, // We'll send manually via SES
    });

    // Generate unsubscribe tokens and send emails
    const jwtSecret = process.env.SECURE_TOKEN;
    if (!jwtSecret) {
      return res.status(500).json({ error: "JWT secret not configured" });
    }

    const fromEmail = process.env.CONTACT_EMAIL;
    if (!fromEmail) {
      return res.status(500).json({ error: "CONTACT_EMAIL environment variable not configured" });
    }

    console.log(`📬 Starting newsletter send to ${subscribedUsers.length} subscribers`);
    console.log(`📋 Newsletter details:`, {
      subject: subject.trim(),
      contentLength: content.trim().length,
      ctaUrl: ctaUrl?.trim() || "none",
      ctaText: ctaText?.trim() || "none",
      fromAddress: fromEmail,
    });

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Process users in batches to respect SES rate limits
    const batchSize = 10;
    for (let i = 0; i < subscribedUsers.length; i += batchSize) {
      const batch = subscribedUsers.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (user: { email: string; data: any }) => {
          try {
            // Generate unsubscribe token
            const unsubscribeToken = jwt.sign({ email: user.email, purpose: "newsletter_unsubscribe" }, jwtSecret, {
              expiresIn: "1y",
            });

            const unsubscribeUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/unsubscribe?token=${unsubscribeToken}`;

            // Get user's name for personalization
            const userData = user.data as any;
            const firstName = userData?.firstName;
            const lastName = userData?.lastName;
            let userName = "Friend";

            if (firstName && lastName) {
              userName = `${firstName} ${lastName}`;
            } else if (firstName) {
              userName = firstName;
            }

            // Convert Markdown content to HTML
            const htmlContent = await convertMarkdownToHtml(content.trim());
            console.log(
              `📝 Generated HTML content preview:`,
              htmlContent.substring(0, 500) + (htmlContent.length > 500 ? "..." : "")
            );

            const html = await email.render("newsletter", {
              subject: subject.trim(),
              siteName,
              userName,
              content: htmlContent,
              ctaUrl: ctaUrl?.trim(),
              ctaText: ctaText?.trim(),
              unsubscribeUrl,
            });

            // Send email via SES
            console.log(`📧 Attempting to send newsletter to: ${user.email}`);
            const emailSent = await sendEmail({
              to: user.email,
              subject: subject.trim(),
              html,
              from: fromEmail,
            });

            if (emailSent) {
              console.log(`✅ Newsletter sent successfully to: ${user.email}`);
              successCount++;
            } else {
              throw new Error("Email sending failed - sendEmail returned false");
            }
          } catch (error: any) {
            errorCount++;
            const errorMsg = `${user.email}: ${error.message}`;
            errors.push(errorMsg);
            console.error(`Failed to send newsletter to ${user.email}:`, error);
          }
        })
      );

      // Add delay between batches to respect SES rate limits (14 emails/second max)
      if (i + batchSize < subscribedUsers.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Save newsletter to history
    const now = firebase.firestore.Timestamp.now();
    const newsletterDoc = {
      subject: subject.trim(),
      content: content.trim(),
      ctaUrl: ctaUrl?.trim() || null,
      ctaText: ctaText?.trim() || null,
      sentAt: now,
      sentBy: adminEmail,
      recipientCount: subscribedUsers.length,
      successCount,
      errorCount,
      errors: errors.slice(0, 10), // Store first 10 errors only
      createdAt: now,
    };

    await firestoreSet(
      db.collection(getNewslettersCollectionName()).doc(),
      newsletterDoc,
      undefined,
      "save newsletter history"
    );

    // Log final results
    console.log(`📊 Newsletter sending completed:`, {
      totalRecipients: subscribedUsers.length,
      successCount,
      errorCount,
      successRate: `${((successCount / subscribedUsers.length) * 100).toFixed(1)}%`,
    });

    if (errors.length > 0) {
      console.error(`❌ Newsletter sending errors:`, errors);
    }

    // Return results
    const response = {
      message: errorCount === 0 ? "Newsletter sent successfully" : `Newsletter sent with ${errorCount} errors`,
      totalRecipients: subscribedUsers.length,
      successCount,
      errorCount,
      ...(errors.length > 0 && { errors: errors.slice(0, 5) }), // Return first 5 errors
    };

    return res.status(errorCount === subscribedUsers.length ? 500 : 200).json(response);
  } catch (error: any) {
    console.error("Newsletter sending error:", error);
    return res.status(500).json({
      error: "Failed to send newsletter",
      details: error.message,
    });
  }
}

export default withJwtAuth(handler);
