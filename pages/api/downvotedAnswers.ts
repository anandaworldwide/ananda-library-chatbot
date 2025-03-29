// This file handles API requests for fetching downvoted answers.
// It is used by the admin interface to review and manage answers that have been downvoted by users.

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '@/services/firebase';
import { getSudoCookie } from '@/utils/server/sudoCookieUtils';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 40, // 40 requests per 5 minutes
    name: 'downvoted-answers-api',
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sudo = getSudoCookie(req, res);
  if (!sudo.sudoCookieValue) {
    return res.status(403).json({ message: `Forbidden: ${sudo.message}` });
  }

  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const answersRef = db.collection(getAnswersCollectionName());
    const downvotedAnswersSnapshot = await answersRef
      .where('vote', '==', -1)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const downvotedAnswers = downvotedAnswersSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        question: data.question || '',
        answer: data.answer || '',
        vote: data.vote || 0,
        timestamp: data.timestamp?.toDate?.() || null,
        collection: data.collection,
        adminAction: data.adminAction,
        adminActionTimestamp: data.adminActionTimestamp,
        sources: data.sources || [],
      };
    });

    return res.status(200).json(downvotedAnswers);
  } catch (error) {
    console.error('Error fetching downvoted answers:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Something went wrong',
    });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
