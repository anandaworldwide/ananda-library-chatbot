import { NextRequest } from 'next/server';
import { NextApiRequest } from 'next';
import { isDevelopment } from '@/utils/env';

export function getClientIp(req: NextApiRequest | NextRequest): string {
  // Special handling for development environment
  if (isDevelopment()) {
    return '127.0.0.1';
  }

  // Check for Cloudflare-specific headers first
  const cfConnectingIp = typeof req.headers.get === 'function' ? 
    req.headers.get('cf-connecting-ip') : 
    (req.headers as Record<string, string | string[]>)['cf-connecting-ip'];

  if (cfConnectingIp) {
    return Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
  }

  // Then check for Vercel-specific headers
  const forwardedFor = typeof req.headers.get === 'function' ? 
    req.headers.get('x-forwarded-for') : 
    (req.headers as Record<string, string | string[]>)['x-forwarded-for'];

  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, we want the first one
    return Array.isArray(forwardedFor) ? 
      forwardedFor[0].split(',')[0].trim() : 
      forwardedFor.split(',')[0].trim();
  }

  // Check for real IP header (common in proxy setups)
  const realIp = typeof req.headers.get === 'function' ? 
    req.headers.get('x-real-ip') : 
    (req.headers as Record<string, string | string[]>)['x-real-ip'];

  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // If no proxy headers found, try to get direct IP
  if ('socket' in req) {
    return req.socket.remoteAddress || '';
  }

  return '';
}
