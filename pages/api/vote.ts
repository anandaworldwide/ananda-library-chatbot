import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '@/services/firebase';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 requests per 5 minutes
    name: 'vote',
  });

  if (!isAllowed) {
    return; // Rate limiter already sent the response
  }

  const { docId, vote } = req.body;

  if (!docId || (vote !== 1 && vote !== 0 && vote !== -1)) {
    return res
      .status(400)
      .json({ error: 'Missing document ID or invalid vote' });
  }

  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const docRef = db.collection(getAnswersCollectionName()).doc(docId);
    // Set the vote to 1 for upvote or -1 for downvote
    await docRef.update({ vote });
    res.status(200).json({ message: 'Vote recorded' });
  } catch (error) {
    console.error('Error recording vote:', error);
    res.status(500).json({ error: 'Failed to record vote' });
  }
}

export default withApiMiddleware(handler);
