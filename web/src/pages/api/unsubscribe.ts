import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { db } from "@/services/firebase";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import firebase from "firebase-admin";

interface UnsubscribeToken {
  email: string;
  purpose: string;
  iat: number;
  exp: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Invalid or missing token" });
    }

    // Verify JWT token
    const jwtSecret = process.env.SECURE_TOKEN;
    if (!jwtSecret) {
      console.error("SECURE_TOKEN not configured for unsubscribe");
      return res.status(500).json({ error: "Server configuration error" });
    }

    let decoded: UnsubscribeToken;
    try {
      decoded = jwt.verify(token, jwtSecret) as UnsubscribeToken;
    } catch (jwtError: any) {
      if (jwtError.name === "TokenExpiredError") {
        return res.status(400).json({ error: "Unsubscribe link has expired" });
      }
      return res.status(400).json({ error: "Invalid unsubscribe token" });
    }

    // Validate token purpose
    if (decoded.purpose !== "newsletter_unsubscribe") {
      return res.status(400).json({ error: "Invalid token purpose" });
    }

    const email = decoded.email?.toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "Invalid email in token" });
    }

    // Update user's newsletter subscription
    const usersCol = getUsersCollectionName();
    const userRef = db.collection(usersCol).doc(email);

    const userDoc = await firestoreGet(userRef, "get user for unsubscribe", email);
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update newsletter subscription to false
    await firestoreSet(
      userRef,
      {
        newsletterSubscribed: false,
        updatedAt: firebase.firestore.Timestamp.now(),
      },
      { merge: true },
      "unsubscribe from newsletter"
    );

    // Load site configuration to get detailed site name
    const siteConfig = await loadSiteConfig();
    const siteName = siteConfig?.name || "Newsletter";

    // Return success page
    const successHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unsubscribed Successfully</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 40px 20px;
            color: #333;
        }
        .container {
            max-width: 500px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .success-icon {
            font-size: 48px;
            color: #28a745;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            font-size: 24px;
            margin-bottom: 16px;
        }
        p {
            color: #666;
            line-height: 1.6;
            margin-bottom: 16px;
        }
        .email {
            font-weight: bold;
            color: #0092e3;
        }
        .note {
            font-size: 14px;
            color: #999;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
        }
        .button {
            border: none;
            border-radius: 6px;
            padding: 12px 24px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            margin: 10px;
            transition: background-color 0.2s;
            text-decoration: none;
            display: inline-block;
            text-align: center;
        }
        .primary-button {
            background-color: #0092e3;
            color: white;
        }
        .primary-button:hover {
            background-color: #007acc;
        }
        .primary-button:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
        .secondary-button {
            background-color: #f8f9fa;
            color: #333;
            border: 1px solid #dee2e6;
        }
        .secondary-button:hover {
            background-color: #e9ecef;
        }
        .button-group {
            margin-top: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }
        @media (min-width: 480px) {
            .button-group {
                flex-direction: row;
                justify-content: center;
            }
        }
        .message {
            margin-top: 15px;
            padding: 10px;
            border-radius: 4px;
            font-size: 14px;
        }
        .success-message {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .error-message {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✓</div>
        <h1>Successfully Unsubscribed</h1>
        <p>The email address <span class="email">${email}</span> has been unsubscribed from <strong>${siteName}</strong> newsletter updates.</p>
        <p>You will no longer receive newsletter emails from us.</p>
        
        <div class="note">
            Changed your mind? You can instantly re-subscribe below or log into your account to update your preferences.
        </div>
        
        <div class="button-group">
            <a href="/" class="button secondary-button">Go to Home Page</a>
            <button class="button primary-button" onclick="resubscribe()">
                Re-subscribe to Newsletter
            </button>
        </div>
        
        <div id="message" class="message" style="display: none;"></div>
    </div>
    
    <script>
        async function resubscribe() {
            const button = document.querySelector('.primary-button');
            const messageDiv = document.getElementById('message');
            
            button.disabled = true;
            button.textContent = 'Re-subscribing...';
            messageDiv.style.display = 'none';
            
            try {
                const response = await fetch('/api/resubscribe', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        token: '${token}'
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    messageDiv.className = 'message success-message';
                    messageDiv.textContent = 'Successfully re-subscribed! You will now receive newsletter updates.';
                    messageDiv.style.display = 'block';
                    button.textContent = 'Re-subscribed ✓';
                    button.style.backgroundColor = '#28a745';
                } else {
                    throw new Error(data.error || 'Failed to re-subscribe');
                }
            } catch (error) {
                messageDiv.className = 'message error-message';
                messageDiv.textContent = 'Failed to re-subscribe: ' + error.message;
                messageDiv.style.display = 'block';
                button.disabled = false;
                button.textContent = 'Re-subscribe to Newsletter';
            }
        }
    </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(successHtml);
  } catch (error: any) {
    console.error("Unsubscribe error:", error);
    return res.status(500).json({ error: "Failed to process unsubscribe request" });
  }
}
