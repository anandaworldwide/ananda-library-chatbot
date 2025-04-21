// CORS middleware configuration
import Cors from 'cors';
import { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { isDevelopment } from '@/utils/env';
import { SiteConfig } from '@/types/siteConfig';

// Configure CORS options
const cors = Cors({
  methods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
  origin: process.env.NEXT_PUBLIC_BASE_URL || '',
  credentials: true,
});

// Helper function to run middleware
export function runMiddleware(
  req: NextApiRequest,
  res: NextApiResponse,
  fn: (
    req: NextApiRequest,
    res: NextApiResponse,
    callback: (result: unknown) => void,
  ) => void,
) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: unknown) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

// Helper function to check if origin matches allowed patterns
function isAllowedOrigin(origin: string, allowedDomains: string[]) {
  return allowedDomains.some((pattern) => {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(origin);
  });
}

// Helper to check development origins
function isAllowedDevOrigin(
  origin: string | undefined | null,
  referer: string | undefined | null,
) {
  if (!isDevelopment()) return false;

  const isLocalOrigin =
    origin?.includes('localhost') || origin?.includes('.local');
  const isLocalReferer =
    referer?.includes('localhost') || referer?.includes('.local');

  return isLocalOrigin || isLocalReferer;
}

// For Pages Router
export function setCorsHeaders(
  req: NextApiRequest,
  res: NextApiResponse,
  siteConfig: SiteConfig,
) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // In development, be more permissive with CORS
  if (isDevelopment()) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return;
  }

  if (isAllowedDevOrigin(origin, referer)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return;
  }

  if (origin) {
    const allowedDomains = siteConfig.allowedFrontEndDomains || [];
    if (isAllowedOrigin(origin, allowedDomains)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
}

// For App Router
export function handleCors(req: NextRequest, siteConfig: SiteConfig) {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  if (!siteConfig) {
    console.error('Failed to load site configuration');
    return NextResponse.json(
      { error: 'Failed to load site configuration' },
      { status: 500 },
    );
  }

  if (isAllowedDevOrigin(origin, referer)) {
    return null; // Allow the request in development
  }

  if (!origin) return null; // Allow requests without origin

  const allowedDomains = siteConfig.allowedFrontEndDomains || [];
  if (isAllowedOrigin(origin, allowedDomains)) {
    return null; // Allow the request
  }

  console.warn(`CORS blocked request from origin: ${origin}`);
  return NextResponse.json(
    { error: 'CORS policy: No access from this origin' },
    { status: 403 },
  );
}

// For App Router responses
export function addCorsHeaders(
  response: NextResponse,
  req: NextRequest,
  siteConfig: SiteConfig,
): NextResponse {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  if (isAllowedDevOrigin(origin, referer)) {
    response.headers.set('Access-Control-Allow-Origin', origin || '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    response.headers.set(
      'Access-Control-Allow-Credentials',
      origin ? 'true' : 'false',
    );
    return response;
  }

  if (!origin) return response;

  const allowedDomains = siteConfig.allowedFrontEndDomains || [];
  if (isAllowedOrigin(origin, allowedDomains)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return response;
}

// Handle OPTIONS requests for both routers
export function handleCorsOptions(
  req: NextRequest | NextApiRequest,
  res?: NextApiResponse,
  siteConfig?: SiteConfig,
) {
  // For Pages Router
  if ('status' in (res as NextApiResponse) && siteConfig) {
    setCorsHeaders(req as NextApiRequest, res as NextApiResponse, siteConfig);
    return (res as NextApiResponse).status(204).end();
  }

  // For App Router
  const response = new NextResponse(null, { status: 204 });
  if (siteConfig) {
    return addCorsHeaders(response, req as NextRequest, siteConfig);
  }
  return response;
}

// Helper to create CORS headers for error responses
export function createErrorCorsHeaders(
  req: NextRequest | NextApiRequest,
  isDev = isDevelopment(),
) {
  let origin: string | null | undefined;

  if ('headers' in req && req.headers instanceof Headers) {
    origin = req.headers.get('origin');
  } else if ('headers' in req && 'origin' in req.headers) {
    origin = req.headers.origin as string;
  }

  return {
    'content-type': 'application/json',
    'Access-Control-Allow-Origin': isDev
      ? origin || '*'
      : origin || process.env.NEXT_PUBLIC_BASE_URL || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export default cors;
