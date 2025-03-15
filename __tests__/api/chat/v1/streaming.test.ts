/** @jest-environment node */
/**
 * Dedicated test suite for streaming functionality of the chat API
 *
 * This file:
 * - Directly calls the route handler and consumes the stream
 * - Verifies proper headers and status codes for streaming responses
 * - Tests error handling in the streaming context
 * - Verifies input validation logic
 *
 * These tests focus primarily on ensuring the streaming interface is set up
 * correctly, without trying to fully parse streams which can cause timeout issues.
 */

// Increase Jest timeout for streaming tests
jest.setTimeout(15000);

// Mock Firebase first, before any imports
jest.mock('@/services/firebase', () => ({
  db: {
    collection: jest.fn().mockReturnValue({
      add: jest.fn().mockResolvedValue({ id: 'test-id' }),
    }),
  },
}));

// Mock the TextEncoder to avoid circular references
const originalTextEncoder = global.TextEncoder;
global.TextEncoder = jest.fn().mockImplementation(() => ({
  encode: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4])),
}));

// Mock other dependencies before importing the route handler
jest.mock('@/utils/server/pinecone-client');
jest.mock('@/utils/server/makechain');
jest.mock('@/utils/server/loadSiteConfig');
jest.mock('@/utils/server/genericRateLimiter');
jest.mock('@langchain/openai');
jest.mock('@langchain/pinecone', () => ({
  PineconeStore: {
    fromExistingIndex: jest.fn().mockResolvedValue({
      asRetriever: jest.fn().mockReturnValue({
        getRelevantDocuments: jest.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

jest.mock('@/utils/server/firestoreUtils', () => ({
  getAnswersCollectionName: jest.fn().mockReturnValue('answers'),
}));
jest.mock('@/utils/server/ipUtils');
jest.mock('@/config/pinecone');
jest.mock('@/utils/env', () => ({
  isDevelopment: jest.fn().mockReturnValue(true),
}));
jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn().mockReturnValue('mock-timestamp'),
    },
  },
  initializeApp: jest.fn(),
}));

import { NextRequest } from 'next/server';

// Import mocked modules
import { getPineconeClient } from '@/utils/server/pinecone-client';
import { makeChain } from '@/utils/server/makechain';
import { loadSiteConfigSync } from '@/utils/server/loadSiteConfig';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';
import { getClientIp } from '@/utils/server/ipUtils';
import { Document } from 'langchain/document';
import { getPineconeIndexName } from '@/config/pinecone';
import { PineconeStore } from '@langchain/pinecone';

// Import the route handler after mocks are set up
import { POST } from '@/app/api/chat/v1/route';

describe('Chat API Streaming', () => {
  // Common test data
  const mockQuestion = 'What is the meaning of life?';
  const mockCollection = 'master_swami';

  // Mock site config
  const mockSiteConfig = {
    siteId: 'ananda-public',
    queriesPerUserPerDay: 100,
    allowedFrontEndDomains: ['*example.com', 'localhost:3000', 'localhost'],
    includedLibraries: [{ name: 'library1', weight: 1 }],
    enabledMediaTypes: ['text', 'audio'],
    modelName: 'gpt-4o',
    temperature: 0.3,
  };

  // Restore original TextEncoder after all tests
  afterAll(() => {
    global.TextEncoder = originalTextEncoder;
  });

  // Setup for all tests
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock loadSiteConfigSync
    (loadSiteConfigSync as jest.Mock).mockReturnValue(mockSiteConfig);

    // Mock rate limiter to always allow
    (genericRateLimiter as jest.Mock).mockResolvedValue(true);

    // Mock getClientIp
    (getClientIp as jest.Mock).mockReturnValue('127.0.0.1');

    // Mock getPineconeIndexName
    (getPineconeIndexName as jest.Mock).mockReturnValue('test-index');

    // Mock Pinecone client
    const mockIndex = {
      query: jest.fn().mockResolvedValue({ matches: [] }),
    };

    (getPineconeClient as jest.Mock).mockResolvedValue({
      Index: jest.fn().mockReturnValue(mockIndex),
    });

    // Ensure PineconeStore.fromExistingIndex returns a properly structured object
    (PineconeStore.fromExistingIndex as jest.Mock).mockResolvedValue({
      asRetriever: jest.fn().mockReturnValue({
        getRelevantDocuments: jest.fn().mockResolvedValue([
          new Document({
            pageContent: 'Mock document content',
            metadata: { source: 'source1' },
          }),
        ]),
      }),
    });

    // Mock makeChain with simple implementation
    (makeChain as jest.Mock).mockImplementation(() => ({
      invoke: jest.fn().mockResolvedValue('Test response'),
    }));
  });

  // Basic test to verify the API responds with a stream
  test('should return a streaming response', async () => {
    // Create a mock request
    const req = new NextRequest(
      new Request('http://localhost/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: mockQuestion,
          collection: mockCollection,
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
        }),
      }),
    );

    // Call the handler
    const response = await POST(req);

    // Verify it returns a response
    expect(response).toBeDefined();
    expect(response.status).toBe(200);

    // Verify it has streaming headers
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toContain('no-cache');
  });

  // Test that verifies error handling in streams
  test('should handle errors in streaming context', async () => {
    // Mock makeChain to throw an error
    (makeChain as jest.Mock).mockImplementation(() => {
      throw new Error('Simulated error for testing');
    });

    // Create a request
    const req = new NextRequest(
      new Request('http://localhost/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: mockQuestion,
          collection: mockCollection,
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
        }),
      }),
    );

    // Call the handler
    const response = await POST(req);

    // Even errors return 200 in streaming context with appropriate headers
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  // Test for model comparison functionality
  test('should handle model comparison requests', async () => {
    // Create a comparison request
    const req = new NextRequest(
      new Request('http://localhost/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: mockQuestion,
          collection: mockCollection,
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
          modelA: 'gpt-4o',
          modelB: 'gpt-3.5-turbo',
          temperatureA: 0.5,
          temperatureB: 0.7,
        }),
      }),
    );

    // Call the handler
    const response = await POST(req);

    // Verify it returns a streaming response
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  // Test to verify input validation
  test('should validate input and return appropriate errors', async () => {
    // Create request with invalid collection
    const req = new NextRequest(
      new Request('http://localhost/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: mockQuestion,
          collection: 'invalid_collection', // Invalid collection
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
        }),
      }),
    );

    // Call the handler
    const response = await POST(req);

    // Should be a standard error response, not a stream
    expect(response.status).toBe(400);

    // Verify error message
    const data = await response.json();
    expect(data.error).toContain('Invalid collection');
  });

  // Test to verify rate limiting
  test('should enforce rate limiting', async () => {
    // Mock rate limiter to deny the request
    (genericRateLimiter as jest.Mock).mockResolvedValue(false);

    // Create a request
    const req = new NextRequest(
      new Request('http://localhost/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: mockQuestion,
          collection: mockCollection,
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
        }),
      }),
    );

    // Call the handler
    const response = await POST(req);

    // Should return a rate limit error
    expect(response.status).toBe(429);

    const data = await response.json();
    expect(data.error).toContain('limit');
  });

  // Test that verifies site ID is sent in the response
  test('should send site ID in streaming response', async () => {
    // Create a mock request
    const req = new NextRequest(
      new Request('http://localhost/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: mockQuestion,
          collection: mockCollection,
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
        }),
      }),
    );

    // Call the handler
    const response = await POST(req);
    expect(response.status).toBe(200);

    // Get the stream
    const stream = response.body;
    expect(stream).toBeDefined();

    // Read the stream
    const reader = stream!.getReader();
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    // Parse the chunks and look for site ID
    const events = chunks.flatMap((chunk) =>
      chunk
        .split('\n\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.replace('data: ', ''))),
    );

    // Verify that site ID was sent
    const siteIdEvent = events.find((event) => event.siteId);
    expect(siteIdEvent).toBeDefined();
    expect(siteIdEvent?.siteId).toBe('ananda-public');
  });

  // Test that verifies warning when fewer sources are returned
  test('should warn when fewer sources are returned than requested', async () => {
    // Mock console.warn to track warnings
    const originalWarn = console.warn;
    const mockWarn = jest.fn();
    console.warn = mockWarn;

    // Mock PineconeStore to return fewer documents than requested
    (PineconeStore.fromExistingIndex as jest.Mock).mockResolvedValue({
      asRetriever: () => ({
        getRelevantDocuments: async () => [
          new Document({ pageContent: 'doc1' }),
          new Document({ pageContent: 'doc2' }),
        ],
      }),
    });

    // Create a request asking for more sources than will be returned
    const req = new NextRequest(
      new Request('http://localhost/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          question: mockQuestion,
          collection: mockCollection,
          history: [],
          privateSession: false,
          mediaTypes: { text: true },
          sourceCount: 4, // Request 4 sources but mock only returns 2
        }),
      }),
    );

    // Call the handler
    const response = await POST(req);
    expect(response.status).toBe(200);

    // Verify warning was logged
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Retrieved 2 sources, but 4 were requested'),
    );

    // Restore console.warn
    console.warn = originalWarn;
  });
});
