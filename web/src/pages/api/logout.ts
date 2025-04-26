import { NextApiRequest, NextApiResponse } from 'next';
import Cookies from 'cookies';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 requests per 5 minutes
    name: 'logout-api',
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method === 'POST') {
    const cookies = new Cookies(req, res);
    cookies.set('siteAuth', '', { expires: new Date(0) });
    cookies.set('isLoggedIn', '', { expires: new Date(0) });
    res.status(200).json({ message: 'Logged out' });
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
