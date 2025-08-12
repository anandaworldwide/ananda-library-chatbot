// Utilities: Generate/secure login magic tokens and send sign-in emails via SES (separate from activation flow).
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

export function generateLoginToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function hashLoginToken(token: string): Promise<string> {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  return bcrypt.hash(token, saltRounds);
}

export function getLoginExpiryDate(days: number = 14): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function sendLoginEmail(email: string, token: string, redirect?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ananda.ai";
  const redirectPart = redirect ? `&redirect=${encodeURIComponent(redirect)}` : "";
  const url = `${baseUrl}/magic-login?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}${redirectPart}`;
  const siteConfig = loadSiteConfigSync();
  const brand = siteConfig?.shortname || siteConfig?.name || process.env.SITE_ID || "your";

  const params = {
    Source: process.env.CONTACT_EMAIL || "noreply@ananda.org",
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Sign in to ${brand}` },
      Body: { Text: { Data: `Click to sign in: ${url}\nThis link expires in 14 days.` } },
    },
  };
  await ses.send(new SendEmailCommand(params));
}
