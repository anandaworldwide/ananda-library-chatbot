// Utilities: Generate/secure email change tokens and send verification emails via SES.
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { loadSiteConfigSync } from "./loadSiteConfig";

const ses = new SESClient({
  region: process.env.AWS_REGION || "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

export function generateEmailChangeToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function hashEmailChangeToken(token: string): Promise<string> {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  return bcrypt.hash(token, saltRounds);
}

export function getEmailChangeExpiryDate(hours: number = 24): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function sendEmailChangeVerificationEmail(newEmail: string, token: string, currentEmail: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const contactEmail = process.env.CONTACT_EMAIL;

  if (!baseUrl) {
    console.error("NEXT_PUBLIC_BASE_URL environment variable is required for email change verification");
    throw new Error("Base URL not configured");
  }

  if (!contactEmail) {
    console.error("CONTACT_EMAIL environment variable is required for sending emails");
    throw new Error("Contact email not configured");
  }

  const url = `${baseUrl}/verify-email-change?token=${encodeURIComponent(token)}&email=${encodeURIComponent(newEmail)}`;
  const siteConfig = loadSiteConfigSync();
  const brand = siteConfig?.name || siteConfig?.shortname || process.env.SITE_ID || "your";

  const params = {
    Source: contactEmail,
    Destination: { ToAddresses: [newEmail] },
    Message: {
      Subject: { Data: `Verify your new email address for ${brand}` },
      Body: {
        Text: {
          Data: `You requested to change your email address from ${currentEmail} to ${newEmail}.\n\nClick to verify your new email address: ${url}\n\nThis link expires in 24 hours.\n\nIf you didn't request this change, please ignore this email.`,
        },
      },
    },
  };
  await ses.send(new SendEmailCommand(params));
}

export async function sendEmailChangeConfirmationEmails(oldEmail: string, newEmail: string) {
  const contactEmail = process.env.CONTACT_EMAIL;

  if (!contactEmail) {
    console.error("CONTACT_EMAIL environment variable is required for sending emails");
    throw new Error("Contact email not configured");
  }

  const siteConfig = loadSiteConfigSync();
  const brand = siteConfig?.name || siteConfig?.shortname || process.env.SITE_ID || "your";

  // Email to old address
  const oldEmailParams = {
    Source: contactEmail,
    Destination: { ToAddresses: [oldEmail] },
    Message: {
      Subject: { Data: `Your ${brand} email address has been changed` },
      Body: {
        Text: {
          Data: `Your email address has been successfully changed from ${oldEmail} to ${newEmail}.\n\nIf you didn't make this change, please contact support immediately.`,
        },
      },
    },
  };

  // Email to new address
  const newEmailParams = {
    Source: contactEmail,
    Destination: { ToAddresses: [newEmail] },
    Message: {
      Subject: { Data: `Email address updated for your ${brand} account` },
      Body: {
        Text: {
          Data: `Your email address has been successfully changed to ${newEmail}.\n\nYou can now use this email address to sign in to your account.`,
        },
      },
    },
  };

  // Send both emails
  await Promise.all([ses.send(new SendEmailCommand(oldEmailParams)), ses.send(new SendEmailCommand(newEmailParams))]);
}
