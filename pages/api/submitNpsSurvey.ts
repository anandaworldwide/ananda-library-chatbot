// This file handles API requests for submitting NPS survey responses.
// It validates the input, checks for recent submissions, and saves the data to a Google Sheet.

import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';

// Handler function for NPS survey submission
async function handleRequest(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 requests per 5 minutes
    name: 'nps-survey-api',
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method Not Allowed' });
    return;
  }

  const { uuid, score, feedback, additionalComments, timestamp } = req.body;

  // Basic validation
  if (!uuid || typeof uuid !== 'string' || uuid.length !== 36) {
    res.status(400).json({ message: 'Invalid UUID' });
    return;
  }

  if (isNaN(score) || score < 0 || score > 10) {
    res.status(400).json({ message: 'Score must be between 0 and 10' });
    return;
  }

  if (feedback && (typeof feedback !== 'string' || feedback.length > 1000)) {
    res
      .status(400)
      .json({ message: 'Feedback must be 1000 characters or less' });
    return;
  }

  if (
    additionalComments &&
    (typeof additionalComments !== 'string' || additionalComments.length > 1000)
  ) {
    res.status(400).json({
      message: 'Additional comments must be 1000 characters or less',
    });
    return;
  }

  if (!timestamp || isNaN(Date.parse(timestamp))) {
    res.status(400).json({ message: 'Invalid timestamp' });
    return;
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Missing Google credentials');
    res.status(500).json({ message: 'Missing Google credentials' });
    return;
  }

  if (!process.env.NPS_SURVEY_GOOGLE_SHEET_ID) {
    console.error('Missing Google Sheet ID');
    res.status(500).json({ message: 'Missing Google Sheet ID' });
    return;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Check if UUID has submitted in the last month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthAgoTimestamp = oneMonthAgo.toISOString();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.NPS_SURVEY_GOOGLE_SHEET_ID,
      range: 'Responses!A:B',
    });

    const rows = response.data.values;
    if (rows) {
      const recentSubmission = rows.find(
        (row) => row[1] === uuid && row[0] > oneMonthAgoTimestamp,
      );

      if (recentSubmission) {
        res
          .status(429)
          .json({ message: 'You can only submit one survey per month' });
        return;
      }
    }

    // If no recent submission, proceed with adding the new entry
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.NPS_SURVEY_GOOGLE_SHEET_ID,
      range: 'Responses',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, uuid, score, feedback, additionalComments]],
      },
    });

    res.status(200).json({ message: 'Survey submitted successfully' });
  } catch (error: any) {
    console.error('Error submitting NPS survey:', error);
    res.status(500).json({
      message: `Error submitting survey: ${error.message || 'Unknown error'}`,
    });
  }
}

// Export with standard JWT auth
export default withJwtAuth(withApiMiddleware(handleRequest));
