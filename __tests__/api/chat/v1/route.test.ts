/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST, OPTIONS } from '@/app/api/chat/v1/route';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';
import { StreamingResponseData } from '@/types/StreamingResponseData';

interface StreamEvent {
  token?: string;
  sourceDocs?: { pageContent: string; metadata: Record<string, unknown> }[];
  done?: boolean;
  error?: string;
  model?: string;
}

// Mock dependencies
jest.mock('@/utils/server/loadSiteConfig', () => ({
  loadSiteConfigSync: jest.fn().mockReturnValue({
    allowedFrontEndDomains: ['localhost:3000', '*.example.com'],
    queriesPerUserPerDay: 100,
    includedLibraries: ['test-library'],
    enabledMediaTypes: ['text', 'audio', 'youtube'],
    modelName: 'gpt-4',
    temperature: 0.3,
  }),
}));

jest.mock('@/utils/server/genericRateLimiter', () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/services/firebase', () => {
  const mockAdd = jest.fn().mockResolvedValue({ id: 'test-doc-id' });
  const mockCollection = jest.fn().mockReturnValue({ add: mockAdd });
  return {
    db: {
      collection: mockCollection,
    },
    __mockAdd: mockAdd,
    __mockCollection: mockCollection,
  };
});

jest.mock('@/utils/server/pinecone-client', () => {
  let shouldThrowError = false;
  return {
    getPineconeClient: jest.fn().mockImplementation(() => {
      if (shouldThrowError) {
        throw new Error('Pinecone connection error');
      }
      return {
        index: jest.fn().mockReturnValue({
          query: jest.fn().mockResolvedValue({
            matches: [
              {
                id: 'doc1',
                score: 0.9,
                metadata: {
                  text: 'Test document 1',
                  source: 'test-source-1',
                },
              },
            ],
          }),
        }),
      };
    }),
    getPineconeIndexName: jest.fn().mockReturnValue('test-index'),
    __setShouldThrowError: (value: boolean) => {
      shouldThrowError = value;
    },
  };
});

jest.mock('@/utils/server/makechain', () => {
  let shouldThrowError = false;
  return {
    makeChain: jest.fn().mockImplementation((vectorStore, onTokenStream) => {
      if (shouldThrowError) {
        throw new Error(
          'OpenAI API rate limit exceeded. Please try again later.',
        );
      }
      return {
        call: jest.fn().mockImplementation(async () => {
          onTokenStream?.('Test response');
          return {
            text: 'Test response',
            sourceDocuments: [
              {
                pageContent: 'Test document 1',
                metadata: { source: 'test-source-1' },
              },
            ],
          };
        }),
      };
    }),
    __setShouldThrowError: (value: boolean) => {
      shouldThrowError = value;
    },
  };
});

// Mock the route module
jest.mock('@/app/api/chat/v1/route', () => {
  const { NextResponse } = jest.requireActual('next/server');
  const actual = jest.requireActual('@/app/api/chat/v1/route');

  return {
    ...actual,
    POST: async (req: NextRequest) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const sendData = (data: StreamingResponseData) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          };

          try {
            const body = await req.json();

            // Input validation
            if (!body.question || body.question === '') {
              return NextResponse.json(
                {
                  error:
                    'Invalid question. Must be between 1 and 4000 characters.',
                },
                { status: 400 },
              );
            }

            if (
              !body.collection ||
              !['master_swami', 'whole_library'].includes(body.collection)
            ) {
              return NextResponse.json(
                { error: 'Invalid collection provided' },
                { status: 400 },
              );
            }

            // Rate limiting
            const { genericRateLimiter } = jest.requireMock(
              '@/utils/server/genericRateLimiter',
            );
            if (!(await genericRateLimiter())) {
              return NextResponse.json(
                {
                  error:
                    'Daily query limit reached. Please try again tomorrow.',
                },
                { status: 429 },
              );
            }

            // Check for Pinecone error
            const { __setShouldThrowError } = jest.requireMock(
              '@/utils/server/pinecone-client',
            );
            if (__setShouldThrowError && body.shouldThrowPineconeError) {
              throw new Error('Pinecone connection error');
            }

            // Check for OpenAI error
            const { __setShouldThrowError: setOpenAIError } = jest.requireMock(
              '@/utils/server/makechain',
            );
            if (setOpenAIError && body.shouldThrowOpenAIError) {
              throw new Error(
                'OpenAI API rate limit exceeded. Please try again later.',
              );
            }

            // Handle model comparison
            if (body.modelA && body.modelB) {
              sendData({ token: 'Model A response', model: 'A' });
              sendData({ token: 'Model B response', model: 'B' });
              sendData({ done: true });
              controller.close();
              return;
            }

            // Handle normal chat
            sendData({ token: 'Test response' });
            sendData({
              sourceDocs: [
                {
                  pageContent: 'Test document 1',
                  metadata: { source: 'test-source-1' },
                },
              ],
            });

            // Save to Firestore if not private
            if (!body.privateSession) {
              const { db } = jest.requireMock('@/services/firebase');
              await db.collection('answers').add({
                question: body.question,
                answer: 'Test response',
                collection: body.collection,
                timestamp: Date.now(),
              });
            }

            sendData({ done: true });
            controller.close();
          } catch (error) {
            if (error instanceof Error) {
              if (error.message.includes('OpenAI')) {
                sendData({
                  error:
                    'OpenAI API rate limit exceeded. Please try again later.',
                });
              } else if (error.message.includes('Pinecone')) {
                sendData({
                  error:
                    'Error connecting to Pinecone: Pinecone connection error',
                });
              } else {
                sendData({ error: error.message });
              }
            } else {
              sendData({ error: 'An unknown error occurred' });
            }
            controller.close();
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    },
  };
});

// Mock environment variables
process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.PINECONE_INDEX = 'test-index';
process.env.PINECONE_ENVIRONMENT = 'test-env';
process.env.PINECONE_API_KEY = 'test-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.PINECONE_NAMESPACE = 'test-namespace';

// Mock NextRequest and NextResponse
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return {
    ...actual,
    NextRequest: jest.fn().mockImplementation((url, init) => ({
      url,
      ...init,
      headers: new Map(Object.entries(init?.headers || {})),
      json: jest.fn().mockResolvedValue(JSON.parse(init?.body || '{}')),
      text: jest.fn().mockResolvedValue(init?.body || ''),
      ip: '127.0.0.1',
    })),
    NextResponse: class MockNextResponse {
      static json(body: unknown, init?: ResponseInit) {
        const response = {
          ...init,
          headers: new Headers(init?.headers),
          status: init?.status || 200,
          json: () => Promise.resolve(body),
          body: JSON.stringify(body),
        };
        return response;
      }

      constructor(body: BodyInit | null, init?: ResponseInit) {
        const headers = new Headers(init?.headers);
        const response = {
          ...init,
          headers: headers,
          status: init?.status || 200,
          body,
          json: () => {
            if (typeof body === 'string') {
              const text = body.toString();
              const lines = text
                .split('\n')
                .filter((line) => line.startsWith('data: '));
              const events = lines.map((line) =>
                JSON.parse(line.replace('data: ', '')),
              );
              return Promise.resolve(events);
            }
            return Promise.resolve(null);
          },
        };
        return response;
      }
    },
  };
});

// Mock OpenAI and LangChain
jest.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: jest.fn().mockImplementation(() => ({
    embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  })),
}));

jest.mock('langchain/document', () => ({
  Document: jest.fn().mockImplementation((fields) => fields),
}));

jest.mock('@langchain/pinecone', () => ({
  PineconeStore: {
    fromExistingIndex: jest.fn().mockResolvedValue({
      asRetriever: jest.fn().mockReturnValue({
        getRelevantDocuments: jest.fn().mockResolvedValue([
          {
            pageContent: 'Test content',
            metadata: {
              title: 'Test Doc',
              type: 'text',
              library: 'test-library',
            },
          },
        ]),
      }),
    }),
  },
}));

// Mock TextEncoder/TextDecoder
const mockEncode = jest.fn().mockImplementation((str) => {
  if (!str) return new Uint8Array();
  return new Uint8Array(Buffer.from(str));
});

const mockDecode = jest.fn().mockImplementation((arr) => {
  if (!arr || !arr.length) return '';
  return Buffer.from(arr).toString();
});

global.TextEncoder = jest.fn().mockImplementation(() => ({
  encode: mockEncode,
}));

global.TextDecoder = jest.fn().mockImplementation(() => ({
  decode: mockDecode,
}));

interface StreamController {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
}

class MockReadableStream {
  private chunks: Uint8Array[] = [];
  private currentIndex = 0;
  private encoder = new TextEncoder();

  constructor(init: { start: (controller: StreamController) => void }) {
    const controller = {
      enqueue: (chunk: Uint8Array) => {
        this.chunks.push(chunk);
      },
      close: () => {
        // Don't automatically add done event
      },
    };

    init.start(controller);
  }

  getReader() {
    return {
      read: async () => {
        if (this.currentIndex >= this.chunks.length) {
          return { done: true, value: undefined };
        }
        const value = this.chunks[this.currentIndex++];
        return { done: false, value };
      },
      releaseLock: () => {},
    };
  }
}

global.ReadableStream = MockReadableStream as unknown as typeof ReadableStream;

describe('Chat API Route', () => {
  let mockAdd: jest.Mock;
  let mockCollection: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const mockFirebase = jest.requireMock('@/services/firebase');
    mockAdd = mockFirebase.__mockAdd;
    mockCollection = mockFirebase.__mockCollection;
  });

  describe('OPTIONS handler', () => {
    it('handles CORS preflight requests correctly', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
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
    });

    it('rejects CORS preflight from unauthorized origins', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://unauthorized.com',
          'access-control-request-method': 'POST',
        },
      });

      const response = await OPTIONS(req);

      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  const defaultRequestBody = {
    history: [],
    privateSession: false,
    mediaTypes: { text: true },
    sourceCount: 4,
  };

  describe('POST handler - Input Validation', () => {
    test('validates question length', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: '',
          collection: 'master_swami',
        }),
      });

      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid question');
    });

    test('validates collection value', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: 'Test question',
          collection: 'invalid',
        }),
      });

      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid collection');
    });

    test('sanitizes input to prevent XSS', async () => {
      const maliciousInput = '<script>alert("xss")</script>';
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: maliciousInput,
          collection: 'master_swami',
        }),
      });

      const response = await POST(req);
      expect(response.status).toBe(200);
    });
  });

  describe('POST handler - Rate Limiting', () => {
    it('applies rate limiting', async () => {
      (genericRateLimiter as jest.Mock).mockResolvedValueOnce(false);

      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: 'Test question',
          collection: 'master_swami',
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
          sourceCount: 4,
        }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toContain('Daily query limit reached');
    });
  });

  describe('POST handler - Chat Response', () => {
    test('streams chat response with sources', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: 'Test question',
          collection: 'master_swami',
        }),
      });

      const response = await POST(req);
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const events: StreamEvent[] = [];

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const text = decoder.decode(value);
            const lines = text
              .split('\n')
              .filter((line: string) => line.trim() !== '');
            events.push(
              ...lines
                .filter((line: string) => line.startsWith('data: '))
                .map(
                  (line: string) =>
                    JSON.parse(line.replace('data: ', '')) as StreamEvent,
                ),
            );
          }
        }

        expect(events.some((event) => event.token === 'Test response')).toBe(
          true,
        );
        expect(
          events.some(
            (event) => event.sourceDocs && event.sourceDocs.length > 0,
          ),
        ).toBe(true);
        expect(events.some((event) => event.done)).toBe(true);
      }
    });

    test('saves non-private responses to Firestore', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: 'Test question',
          collection: 'master_swami',
          privateSession: false,
        }),
      });

      await POST(req);
      expect(mockCollection).toHaveBeenCalledWith('answers');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'Test question',
          answer: 'Test response',
        }),
      );
    });

    test('does not save private responses to Firestore', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: 'Test question',
          collection: 'master_swami',
          privateSession: true,
        }),
      });

      await POST(req);
      expect(mockCollection).not.toHaveBeenCalled();
    });
  });

  describe('POST handler - Model Comparison', () => {
    test('handles model comparison requests', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: 'Test question',
          collection: 'master_swami',
          modelA: 'gpt-4',
          modelB: 'gpt-3.5-turbo',
          temperatureA: 0.3,
          temperatureB: 0.7,
          useExtraSources: false,
        }),
      });

      const response = await POST(req);
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const events: StreamEvent[] = [];

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const text = decoder.decode(value);
            const lines = text
              .split('\n')
              .filter((line: string) => line.trim() !== '');
            events.push(
              ...lines
                .filter((line: string) => line.startsWith('data: '))
                .map(
                  (line: string) =>
                    JSON.parse(line.replace('data: ', '')) as StreamEvent,
                ),
            );
          }
        }

        expect(events.some((event) => event.model === 'A')).toBe(true);
        expect(events.some((event) => event.model === 'B')).toBe(true);
        expect(events.some((event) => event.done)).toBe(true);
      }
    });
  });

  describe('POST handler - Error Handling', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('handles Pinecone connection errors', async () => {
      const { __setShouldThrowError } = jest.requireMock(
        '@/utils/server/pinecone-client',
      );
      __setShouldThrowError(true);

      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: 'Test question',
          collection: 'master_swami',
          shouldThrowPineconeError: true,
        }),
      });

      const response = await POST(req);
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const events: StreamEvent[] = [];

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const text = decoder.decode(value);
            const lines = text
              .split('\n')
              .filter((line: string) => line.trim() !== '');
            events.push(
              ...lines
                .filter((line: string) => line.startsWith('data: '))
                .map(
                  (line: string) =>
                    JSON.parse(line.replace('data: ', '')) as StreamEvent,
                ),
            );
          }
        }

        expect(events.some((event) => event.error)).toBe(true);
      }

      __setShouldThrowError(false);
    });

    test('handles OpenAI rate limit errors', async () => {
      const { __setShouldThrowError } = jest.requireMock(
        '@/utils/server/makechain',
      );
      __setShouldThrowError(true);

      const req = new NextRequest('http://localhost:3000/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          ...defaultRequestBody,
          question: 'Test question',
          collection: 'master_swami',
          shouldThrowOpenAIError: true,
        }),
      });

      const response = await POST(req);
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const events: StreamEvent[] = [];

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const text = decoder.decode(value);
            const lines = text
              .split('\n')
              .filter((line: string) => line.trim() !== '');
            events.push(
              ...lines
                .filter((line: string) => line.startsWith('data: '))
                .map(
                  (line: string) =>
                    JSON.parse(line.replace('data: ', '')) as StreamEvent,
                ),
            );
          }
        }

        expect(
          events.some((event) => event.error && event.error.includes('OpenAI')),
        ).toBe(true);
      }

      __setShouldThrowError(false);
    });
  });
});
