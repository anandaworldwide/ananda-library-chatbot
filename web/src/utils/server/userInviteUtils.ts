// Utilities: Generate/secure activation tokens and send branded activation emails via SES.
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { loadSiteConfigSync } from "./loadSiteConfig";
import { createEmailParams } from "./emailTemplates";

const ses = new SESClient({
  region: process.env.AWS_REGION || "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

export function generateInviteToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function hashInviteToken(token: string): Promise<string> {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  return bcrypt.hash(token, saltRounds);
}

export function getInviteExpiryDate(days: number = 14): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function sendActivationEmail(email: string, token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ananda.ai";
  const url = `${baseUrl}/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const siteConfig = loadSiteConfigSync();
  const brand = siteConfig?.name || siteConfig?.shortname || process.env.SITE_ID || "your";

  const message = `Click to activate: ${url}

This link expires in 14 days.`;

  const params = createEmailParams(
    process.env.CONTACT_EMAIL || "noreply@ananda.org",
    email,
    `Activate your account with ${brand}`,
    {
      message,
      baseUrl,
      siteId: process.env.SITE_ID,
    }
  );

  await ses.send(new SendEmailCommand(params));
}
