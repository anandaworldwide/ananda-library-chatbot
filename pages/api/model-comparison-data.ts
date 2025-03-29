// This file handles API requests for retrieving model comparison vote data.
// It returns paginated data of model comparison votes, primarily for admin dashboards.

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '@/services/firebase';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { isDevelopment } from '@/utils/env';
import { getSudoCookie } from '@/utils/server/sudoCookieUtils';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 requests per 5 minutes
    name: 'model-comparison-data-api',
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check sudo cookie authentication
  const sudoStatus = getSudoCookie(req, res);
  if (!sudoStatus.sudoCookieValue) {
    return res
      .status(403)
      .json({ error: 'Unauthorized: Sudo access required' });
  }

  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = (page - 1) * limit;

  try {
    const prefix = isDevelopment() ? 'dev_' : 'prod_';
    const collectionRef = db.collection(`${prefix}model_comparison_votes`);

    // Get total count
    const snapshot = await collectionRef.count().get();
    const total = snapshot.data().count;

    // Get paginated data
    const querySnapshot = await collectionRef
      .orderBy('timestamp', 'desc')
      .offset(offset)
      .limit(limit)
      .get();

    const comparisons = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp.toDate().toISOString(),
    }));

    res.status(200).json({
      comparisons,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching model comparisons:', error);
    res.status(500).json({ error: 'Failed to fetch model comparisons' });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
