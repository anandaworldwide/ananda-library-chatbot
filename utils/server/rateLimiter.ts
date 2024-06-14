import { db } from '@/services/firebase';
import { NextApiRequest, NextApiResponse } from 'next';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5;

// Rate limiting by IP address. All uses of this contribute to counts against IP addresses. 
export async function rateLimiter(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const ip = req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();

  // sharing one collection across dev and prod
  const rateLimitRef = db.collection('rateLimits').doc(ip);

  const rateLimitDoc = await rateLimitRef.get();
  if (!rateLimitDoc.exists) {
    await rateLimitRef.set({
      count: 1,
      firstRequestTime: now,
    });
    return true;
  }

  const rateLimitData = rateLimitDoc.data();
  if (rateLimitData) {
    const { count, firstRequestTime } = rateLimitData;
    if (now - firstRequestTime < RATE_LIMIT_WINDOW_MS) {
        await rateLimitRef.update({
            count: count + 1,
          });
        if (count >= MAX_REQUESTS) {
            res.status(429).json({ message: 'Too many attempts. Please try again later.' });
            return false;
        } else {
            return true;
        }
    } else {
      await rateLimitRef.set({
        count: 1,
        firstRequestTime: now,
      });
      return true;
    }
  }
  return true;
}