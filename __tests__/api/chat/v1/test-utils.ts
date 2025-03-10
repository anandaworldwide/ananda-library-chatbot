import { NextRequest, NextResponse } from 'next/server';
import { RequestInit } from 'next/dist/server/web/spec-extension/request';

// Mock dependencies
export const mockSiteConfig = {
  allowedOrigins: ['https://example.com', '*.example.com'],
  pineconeIndex: 'test-index',
  pineconeEnvironment: 'test-env',
  openaiApiKey: 'test-key',
  pineconeApiKey: 'test-key',
  firebaseServiceAccount: {},
  firebaseProjectId: 'test-project',
};

export const mockFirebase = {
  collection: jest.fn().mockReturnValue({
    add: jest.fn().mockResolvedValue({ id: 'test-id' }),
  }),
};

export const mockPinecone = {
  init: jest.fn().mockResolvedValue(undefined),
  Index: jest.fn().mockReturnValue({
    query: jest.fn().mockResolvedValue({
      matches: [
        {
          id: 'test-id',
          score: 0.9,
          metadata: {
            text: 'Test text',
            source: 'Test source',
          },
        },
      ],
    }),
  }),
};

export const mockMakeChain = jest.fn().mockResolvedValue({
  call: jest.fn().mockResolvedValue({
    text: 'Test response',
    sourceDocuments: [
      {
        pageContent: 'Test content',
        metadata: { source: 'Test source' },
      },
    ],
  }),
});

// Mock NextRequest and NextResponse
export const mockNextRequest = () => {
  return class extends NextRequest {
    constructor(url: string | URL, init?: RequestInit) {
      super(url, init as RequestInit & { duplex?: string });
    }
  };
};

export const mockNextResponse = () => {
  return class extends NextResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
    }
  };
};

// Mock environment variables
export const setupTestEnv = () => {
  process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.PINECONE_INDEX = 'test-index';
  process.env.PINECONE_ENVIRONMENT = 'test-env';
  process.env.PINECONE_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.PINECONE_NAMESPACE = 'test-namespace';
};

// Helper function to create a streaming response
export const createStreamingResponse = (text: string) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token: text })}\n\n`),
      );
      controller.close();
    },
  });
  return stream;
};
