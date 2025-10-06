import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { firestoreSet } from "@/utils/server/firestoreRetryUtils";
import { writeAuditLog } from "@/utils/server/auditLog";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { createEmailParams } from "@/utils/server/emailTemplates";

const ses = new SESClient({
  region: process.env.AWS_REGION || "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

interface ApprovalRequestData {
  requesterEmail: string;
  requesterName: string;
  adminEmail: string;
  adminName: string;
  adminLocation: string;
  requestId: string;
  status: "pending";
  createdAt: firebase.firestore.Timestamp;
  updatedAt: firebase.firestore.Timestamp;
}

export async function sendApprovalRequestEmail(
  requesterEmail: string,
  requesterName: string,
  adminEmail: string,
  adminName: string,
  requestId: string,
  req?: any
) {
  // Use request domain if available, otherwise fall back to configured domain
  let baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_BASE_URL environment variable is required for email generation");
  }

  if (req && req.headers) {
    const host = req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || (host?.includes("localhost") ? "http" : "https");
    if (host) {
      baseUrl = `${protocol}://${host}`;
    }
  }

  const siteConfig = await loadSiteConfig();
  const brand = siteConfig?.shortname || siteConfig?.name || process.env.SITE_ID || "Ananda Library Chatbot";

  // Create review URL for admin
  const reviewUrl = `${baseUrl}/admin/approvals?request=${requestId}`;

  const message = `${requesterName} (${requesterEmail}) has requested access to ${brand}.

Please review this request and approve or deny access.

Review Request

(Or visit ${reviewUrl})

This request requires your approval to proceed.`;

  const params = createEmailParams(
    process.env.CONTACT_EMAIL || "noreply@ananda.org",
    adminEmail,
    `New ${brand} Access Request for ${requesterName}`,
    {
      greeting: `Hi ${adminName},`,
      message,
      baseUrl,
      siteId: process.env.SITE_ID,
      actionUrl: reviewUrl,
      actionText: "Review Request",
    }
  );

  await ses.send(new SendEmailCommand(params));
}

export async function sendRequesterConfirmationEmail(
  requesterEmail: string,
  requesterName: string,
  adminName: string,
  adminLocation: string,
  req?: any
) {
  // Use request domain if available, otherwise fall back to configured domain
  let baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_BASE_URL environment variable is required for email generation");
  }

  if (req && req.headers) {
    const host = req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || (host?.includes("localhost") ? "http" : "https");
    if (host) {
      baseUrl = `${protocol}://${host}`;
    }
  }

  const siteConfig = await loadSiteConfig();
  const brand = siteConfig?.name || siteConfig?.shortname || process.env.SITE_ID || "Ananda Library Chatbot";

  const message = `Thank you for your interest in ${brand}. Your access request has been submitted to ${adminName} (${adminLocation}).

They will review your request and get back to you soon. You should receive a response within three business days.

If you have any questions in the meantime, feel free to contact us.

Best regards,
The ${brand} Team`;

  const params = createEmailParams(
    process.env.CONTACT_EMAIL || "noreply@ananda.org",
    requesterEmail,
    "Access Request Submitted",
    {
      greeting: `Hi ${requesterName},`,
      message,
      baseUrl,
      siteId: process.env.SITE_ID,
    }
  );

  await ses.send(new SendEmailCommand(params));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Apply rate limiting
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per minute
    name: "admin_request_approval",
  });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { requesterEmail, requesterName, adminEmail, adminName, adminLocation } = req.body as {
    requesterEmail?: string;
    requesterName?: string;
    adminEmail?: string;
    adminName?: string;
    adminLocation?: string;
  };

  // Validate required fields
  if (!requesterEmail || typeof requesterEmail !== "string") {
    return res.status(400).json({ error: "Requester email is required" });
  }
  if (!requesterName || typeof requesterName !== "string") {
    return res.status(400).json({ error: "Requester name is required" });
  }
  if (!adminEmail || typeof adminEmail !== "string") {
    return res.status(400).json({ error: "Admin email is required" });
  }
  if (!adminName || typeof adminName !== "string") {
    return res.status(400).json({ error: "Admin name is required" });
  }
  if (!adminLocation || typeof adminLocation !== "string") {
    return res.status(400).json({ error: "Admin location is required" });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(requesterEmail) || !emailRegex.test(adminEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  try {
    // Generate unique request ID
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const now = firebase.firestore.Timestamp.now();

    const approvalRequest: ApprovalRequestData = {
      requesterEmail: requesterEmail.toLowerCase(),
      requesterName: requesterName.trim(),
      adminEmail: adminEmail.toLowerCase(),
      adminName: adminName.trim(),
      adminLocation: adminLocation.trim(),
      requestId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    // Store in Firestore
    const siteConfig = await loadSiteConfig();
    const siteId = siteConfig?.siteId || "default";
    const collectionName = `${siteId}_admin_approval_requests`;

    await firestoreSet(
      db.collection(collectionName).doc(requestId),
      approvalRequest,
      undefined,
      "create admin approval request"
    );

    // Send emails (in parallel for better performance)
    const emailPromises = [
      sendApprovalRequestEmail(requesterEmail, requesterName, adminEmail, adminName, requestId, req),
      sendRequesterConfirmationEmail(requesterEmail, requesterName, adminName, adminLocation, req),
    ];

    try {
      await Promise.all(emailPromises);
    } catch (emailError) {
      console.error("Error sending approval emails:", emailError);
      // Continue with success response even if emails fail - the request is still created
    }

    // Log audit event
    await writeAuditLog(req, "admin_approval_request", requesterEmail.toLowerCase(), {
      outcome: "request_created",
      adminEmail: adminEmail.toLowerCase(),
      requestId,
    });

    return res.status(200).json({
      message: "Approval request submitted successfully",
      requestId,
    });
  } catch (error: any) {
    console.error("Error creating approval request:", error);

    // Log error audit event
    try {
      await writeAuditLog(req, "admin_approval_request", requesterEmail?.toLowerCase(), {
        outcome: "error",
        error: error.message,
        adminEmail: adminEmail?.toLowerCase(),
      });
    } catch {}

    return res.status(500).json({ error: "Internal server error" });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
