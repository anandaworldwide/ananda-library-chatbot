// HTML email template utilities with login image and site branding support
import { loadSiteConfigSync } from "./loadSiteConfig";

interface EmailTemplateOptions {
  greeting?: string;
  message: string;
  signature?: string;
  loginImageUrl?: string | null;
  baseUrl?: string;
  siteId?: string;
}

/**
 * Generates both HTML and plain text versions of an email
 * Follows the format: <emailGreeting> <message> -- <name> <loginImage>
 */
export function generateEmailContent(options: EmailTemplateOptions): {
  html: string;
  text: string;
} {
  const siteConfig = loadSiteConfigSync(options.siteId);
  const baseUrl = options.baseUrl || process.env.NEXT_PUBLIC_BASE_URL || "https://ananda.ai";

  // Get site-specific values
  const emailGreeting = options.greeting || siteConfig?.emailGreeting || "Hi there,";
  const siteName = siteConfig?.name || siteConfig?.shortname || "your account";
  const shortName = siteConfig?.shortname || siteName;
  const signature = options.signature || shortName;

  // Determine login image URL
  let loginImageUrl = "";
  if (siteConfig?.loginImage && options.loginImageUrl !== null) {
    // If loginImage is configured and not explicitly disabled
    // Use absolute URL for email clients - images are served from public root
    loginImageUrl = `${baseUrl}/${siteConfig.loginImage}`;
  }

  // Generate plain text version
  const textContent = [
    emailGreeting,
    "",
    options.message,
    "",
    `-- ${signature}`,
    loginImageUrl ? `\nView online: ${baseUrl}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  // Generate HTML version
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8f9fa;
    }
    .email-container {
      background-color: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .greeting {
      font-size: 16px;
      margin-bottom: 20px;
      color: #2c3e50;
    }
    .message {
      font-size: 16px;
      margin-bottom: 30px;
      white-space: pre-line;
    }
    .signature {
      font-size: 16px;
      color: #7f8c8d;
      margin-bottom: 30px;
      border-top: 1px solid #ecf0f1;
      padding-top: 20px;
    }
            ${
              loginImageUrl
                ? `
        .login-image {
          text-align: center;
          margin-top: 20px;
        }
        .login-image img {
          max-width: 200px;
          height: auto;
          border-radius: 8px;
        }`
                : ""
            }

    a {
      color: #3498db;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="greeting">${emailGreeting}</div>
    
    <div class="message">${options.message}</div>
    
    <div class="signature">-- ${signature}</div>
    
    ${
      loginImageUrl
        ? `
    <div class="login-image">
      <img src="${loginImageUrl}" alt="${shortName}" />
    </div>
    `
        : ""
    }
  </div>
</body>
</html>`.trim();

  return {
    html: htmlContent,
    text: textContent,
  };
}

/**
 * Helper function to create email parameters for SES with both HTML and text versions
 */
export function createEmailParams(
  fromEmail: string,
  toEmail: string,
  subject: string,
  templateOptions: EmailTemplateOptions
) {
  const { html, text } = generateEmailContent(templateOptions);

  return {
    Source: fromEmail,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject },
      Body: {
        Html: { Data: html },
        Text: { Data: text },
      },
    },
  };
}
