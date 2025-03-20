/** @jest-environment node */
import { NextRequest } from 'next/server';
import { OPTIONS } from '@/app/api/chat/v1/route';

jest.mock('@/utils/server/loadSiteConfig', () => ({
  loadSiteConfig: jest.fn().mockResolvedValue({
    allowedFrontEndDomains: ['example.com', '*.example.com'],
  }),
  loadSiteConfigSync: jest.fn().mockReturnValue({
    allowedFrontEndDomains: ['example.com', '*.example.com'],
  }),
}));

jest.mock('@/services/firebase', () => ({
  db: {
    collection: jest.fn().mockReturnValue({
      add: jest.fn().mockResolvedValue({ id: 'test-id' }),
    }),
  },
}));

jest.mock('@/utils/server/pinecone-client', () => ({
  getPineconeClient: jest.fn().mockResolvedValue({
    index: jest.fn().mockReturnValue({
      query: jest.fn().mockResolvedValue({
        matches: [],
      }),
    }),
  }),
  getCachedPineconeIndex: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({
      matches: [],
    }),
  }),
}));

jest.mock('@/config/pinecone', () => ({
  getPineconeIndexName: jest.fn().mockReturnValue('test-index'),
}));

jest.mock('@/utils/env', () => ({
  isDevelopment: jest.fn().mockReturnValue(false),
}));

jest.mock('next/server', () => {
  const mockResponse = jest.fn().mockImplementation((body, init) => ({
    status: init?.status || 200,
    headers: new Headers(init?.headers),
    json: async () => body,
  }));
  const mockResponseJson = mockResponse as jest.Mock & {
    json: jest.Mock;
  };
  mockResponseJson.json = jest.fn().mockImplementation((body, init) => ({
    status: init?.status || 200,
    headers: new Headers(init?.headers),
    json: async () => body,
  }));
  return {
    ...jest.requireActual('next/server'),
    NextRequest: jest.fn().mockImplementation((url, init) => ({
      url,
      method: init?.method || 'GET',
      headers: new Headers(init?.headers),
    })),
    NextResponse: mockResponseJson,
  };
});

describe('CORS Handling', () => {
  describe('OPTIONS handler', () => {
    test('handles CORS preflight requests correctly', async () => {
      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://example.com',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
    });

    test('rejects CORS preflight from unauthorized origins', async () => {
      const req = new NextRequest('https://evil.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.com',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('allows wildcard pattern matches', async () => {
      const req = new NextRequest('https://subdomain.example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://subdomain.example.com',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://subdomain.example.com',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
    });

    test('allows localhost in development mode', async () => {
      const { isDevelopment } = jest.requireMock('@/utils/env');
      isDevelopment.mockReturnValue(true);

      const req = new NextRequest('http://localhost:3000', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:3000',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );

      isDevelopment.mockReturnValue(false);
    });

    test('returns error when site config is missing', async () => {
      const { loadSiteConfigSync } = jest.requireMock(
        '@/utils/server/loadSiteConfig',
      );
      loadSiteConfigSync.mockReturnValue(null);

      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({ error: 'Failed to load site configuration' });

      loadSiteConfigSync.mockReturnValue({
        allowedFrontEndDomains: ['example.com', '*.example.com'],
      });
    });

    test('handles requests without origin header', async () => {
      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('access-control-allow-methods')).toBeNull();
    });

    test('allows WordPress requests in development mode', async () => {
      const { isDevelopment } = jest.requireMock('@/utils/env');
      isDevelopment.mockReturnValue(true);

      const req = new NextRequest('http://localhost/wordpress', {
        method: 'OPTIONS',
        headers: {
          referer: 'http://localhost/wordpress',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'false',
      );

      isDevelopment.mockReturnValue(false);
    });

    test('ignores WordPress requests in production mode', async () => {
      const req = new NextRequest('http://localhost/wordpress', {
        method: 'OPTIONS',
        headers: {
          referer: 'http://localhost/wordpress',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('access-control-allow-methods')).toBeNull();
    });

    test('prioritizes origin header over referer', async () => {
      const { isDevelopment } = jest.requireMock('@/utils/env');
      isDevelopment.mockReturnValue(true);

      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          referer: 'http://localhost/wordpress',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://example.com',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );

      isDevelopment.mockReturnValue(false);
    });

    test('rejects requests with invalid methods', async () => {
      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'DELETE',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://example.com',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
    });

    test('rejects requests with invalid headers', async () => {
      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'X-Custom-Header',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://example.com',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'Content-Type, Authorization',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
    });

    test('handles requests with both allowed and disallowed headers', async () => {
      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Content-Type, X-Custom-Header',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://example.com',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'Content-Type, Authorization',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
    });

    test('handles requests with multiple allowed methods', async () => {
      const req = new NextRequest('https://example.com', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET, POST',
        },
      });

      const response = await OPTIONS(req);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://example.com',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, POST, OPTIONS',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
    });
  });
});
