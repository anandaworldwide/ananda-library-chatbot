/** @jest-environment node */
/**
 * Test suite for the document retrieval functionality in makechain.ts
 *
 * These tests verify the behavior of the retrievalSequence logic in makechain.ts:
 * 1. When the includedLibraries is an array of strings (unweighted), it should use a single query with $or filter
 * 2. When the includedLibraries is an array of objects with weights, it should use multiple queries
 * 3. Base filters should be properly applied in conjunction with library filters
 */

import { Document } from 'langchain/document';
import fs from 'fs/promises';
import path from 'path';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('path');

describe('Document Retrieval Logic', () => {
  // Default site configuration with templates
  const defaultSiteConfig = {
    variables: {
      siteName: 'Test Site',
      assistantName: 'Test Assistant',
    },
    templates: {
      baseTemplate:
        'You are {assistantName} for {siteName}. Use the following context to answer the question.\n\nContext: {context}\n\nQuestion: {question}\n\nAnswer:',
      condenseTemplate:
        'Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.\n\n<chat_history>\n{chat_history}\n</chat_history>\n\nFollow Up Input: {question}\nStandalone question:',
    },
  };

  // Mock path.join
  beforeEach(() => {
    jest.clearAllMocks();

    // Set environment variables
    process.env.SITE_ID = 'test-site';

    // Mock path.join
    jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
  });

  test('should use a single query with $or filter for unweighted libraries', async () => {
    // Mock config with unweighted libraries (string array)
    const mockConfig = {
      'test-site': {
        includedLibraries: ['library1', 'library2', 'library3'],
      },
    };

    // Setup fs mock
    jest.spyOn(fs, 'readFile').mockImplementation((filePath) => {
      if (typeof filePath === 'string') {
        if (filePath.includes('config.json')) {
          return Promise.resolve(JSON.stringify(mockConfig));
        } else if (filePath.includes('test-site.json')) {
          return Promise.resolve(JSON.stringify(defaultSiteConfig));
        }
      }
      return Promise.resolve('{}');
    });

    // Create a mock vectorStore with spied similaritySearch
    const mockSimilaritySearch = jest.fn().mockResolvedValue([
      new Document({
        pageContent: 'test',
        metadata: { library: 'library1' },
      }),
    ]);

    const mockVectorStore = { similaritySearch: mockSimilaritySearch };

    // Create a mock retriever
    const mockRetriever = { vectorStore: mockVectorStore };

    // Import the real module now that mocks are set up
    const { makeChain } = await import('../../utils/server/makechain');

    // Call makeChain
    const chain = await makeChain(mockRetriever as any, {
      model: 'gpt-4o',
      temperature: 0.5,
    });

    // Try to execute the chain
    try {
      await chain.invoke({ question: 'test question', chat_history: '' });
    } catch (error) {
      // Expected error - we're not fully mocking the chain execution
    }

    // Check if a single query was made with $or filter
    const orFilterCalls = mockSimilaritySearch.mock.calls.filter(
      (call) => call[2] && call[2].$or,
    );

    // Verify we have at least one call with an $or filter
    expect(orFilterCalls.length).toBeGreaterThan(0);

    // Verify all expected libraries are in the filter
    const libraryFilters = orFilterCalls[0][2].$or.map(
      (f: { library: string }) => f.library,
    );
    expect(libraryFilters).toEqual(
      expect.arrayContaining(['library1', 'library2', 'library3']),
    );

    // Verify we don't have separate calls for individual libraries
    const individualLibraryCalls = mockSimilaritySearch.mock.calls.filter(
      (call) => call[2] && call[2].library,
    );
    expect(individualLibraryCalls.length).toBe(0);
  });

  test('should use multiple queries when libraries have weights', async () => {
    // Mock config with weighted libraries
    const mockConfig = {
      'test-site': {
        includedLibraries: [
          { name: 'library1', weight: 2 },
          { name: 'library2', weight: 1 },
        ],
      },
    };

    // Setup fs mock
    jest.spyOn(fs, 'readFile').mockImplementation((filePath) => {
      if (typeof filePath === 'string') {
        if (filePath.includes('config.json')) {
          return Promise.resolve(JSON.stringify(mockConfig));
        } else if (filePath.includes('test-site.json')) {
          return Promise.resolve(JSON.stringify(defaultSiteConfig));
        }
      }
      return Promise.resolve('{}');
    });

    // Create a mock vectorStore with spied similaritySearch
    const mockSimilaritySearch = jest.fn().mockResolvedValue([
      new Document({
        pageContent: 'test',
        metadata: { library: 'library1' },
      }),
    ]);

    const mockVectorStore = { similaritySearch: mockSimilaritySearch };

    // Create a mock retriever
    const mockRetriever = { vectorStore: mockVectorStore };

    // Import the real module now that mocks are set up
    const { makeChain } = await import('../../utils/server/makechain');

    // Call makeChain
    const chain = await makeChain(mockRetriever as any, {
      model: 'gpt-4o',
      temperature: 0.5,
    });

    // Try to execute the chain
    try {
      await chain.invoke({ question: 'test question', chat_history: '' });
    } catch (error) {
      // Expected error - we're not fully mocking the chain execution
    }

    // Verify individual calls for each library
    const lib1Calls = mockSimilaritySearch.mock.calls.filter(
      (call) => call[2] && call[2].library === 'library1',
    );

    const lib2Calls = mockSimilaritySearch.mock.calls.filter(
      (call) => call[2] && call[2].library === 'library2',
    );

    // Verify we have calls for both libraries
    expect(lib1Calls.length).toBeGreaterThan(0);
    expect(lib2Calls.length).toBeGreaterThan(0);

    // Check that library1 was asked for more documents than library2
    // based on the weight ratio of 2:1
    if (lib1Calls.length && lib2Calls.length) {
      expect(lib1Calls[0][1]).toBeGreaterThan(lib2Calls[0][1]);
    }

    // Verify we don't have an $or query
    const orFilterCalls = mockSimilaritySearch.mock.calls.filter(
      (call) => call[2] && call[2].$or,
    );
    expect(orFilterCalls.length).toBe(0);
  });

  test('should apply baseFilter correctly with unweighted libraries', async () => {
    // Mock config with unweighted libraries
    const mockConfig = {
      'test-site': {
        includedLibraries: ['library1', 'library2'],
      },
    };

    // Setup fs mock
    jest.spyOn(fs, 'readFile').mockImplementation((filePath) => {
      if (typeof filePath === 'string') {
        if (filePath.includes('config.json')) {
          return Promise.resolve(JSON.stringify(mockConfig));
        } else if (filePath.includes('test-site.json')) {
          return Promise.resolve(JSON.stringify(defaultSiteConfig));
        }
      }
      return Promise.resolve('{}');
    });

    // Create a mock vectorStore with spied similaritySearch
    const mockSimilaritySearch = jest.fn().mockResolvedValue([
      new Document({
        pageContent: 'test',
        metadata: { library: 'library1' },
      }),
    ]);

    const mockVectorStore = { similaritySearch: mockSimilaritySearch };

    // Create a mock retriever
    const mockRetriever = { vectorStore: mockVectorStore };

    // Custom baseFilter to apply
    const baseFilter = { type: 'article' };

    // Import the real module now that mocks are set up
    const { makeChain } = await import('../../utils/server/makechain');

    // Call makeChain with baseFilter
    const chain = await makeChain(
      mockRetriever as any,
      { model: 'gpt-4o', temperature: 0.5 },
      4, // sourceCount
      baseFilter,
    );

    // Try to execute the chain
    try {
      await chain.invoke({ question: 'test question', chat_history: '' });
    } catch (error) {
      // Expected error - we're not fully mocking the chain execution
    }

    // Find the call with an $and filter
    const andFilterCalls = mockSimilaritySearch.mock.calls.filter(
      (call) => call[2] && call[2].$and,
    );

    // Verify we have a call with an $and filter
    expect(andFilterCalls.length).toBeGreaterThan(0);

    const filterArgs = andFilterCalls[0][2];

    // Verify the first part is our type filter
    expect(filterArgs.$and[0]).toEqual(baseFilter);

    // Verify the second part is the $or filter for libraries
    expect(filterArgs.$and[1].$or).toBeDefined();

    // Check the library filters
    const libraryFilters = filterArgs.$and[1].$or.map(
      (f: { library: string }) => f.library,
    );
    expect(libraryFilters).toEqual(
      expect.arrayContaining(['library1', 'library2']),
    );
  });
});
