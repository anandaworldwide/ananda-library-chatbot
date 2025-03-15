/**
 * Tests for the voteHandler utility
 */

import { handleVote } from '@/utils/client/voteHandler';

// Mock the analytics module
jest.mock('@/utils/client/analytics', () => ({
  logEvent: jest.fn(),
}));

// Import after mocking
import * as analytics from '@/utils/client/analytics';

// Mock the fetch function
global.fetch = jest.fn() as jest.Mock;

describe('voteHandler', () => {
  let setVotes: jest.Mock;
  let setVoteError: jest.Mock;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Enable fake timers
    jest.useFakeTimers();

    // Reset all mocks
    jest.clearAllMocks();
    setVotes = jest.fn();
    setVoteError = jest.fn();
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    // Default fetch mock implementation
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    // Restore real timers
    jest.useRealTimers();
  });

  it('should handle upvote successfully', async () => {
    const docId = 'doc123';
    const votes = {};

    await handleVote(docId, true, votes, setVotes, setVoteError);

    // Check analytics was logged
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'upvote_answer',
      'Engagement',
      docId,
      1,
    );

    // Check API was called correctly
    expect(fetch).toHaveBeenCalledWith('/api/vote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ docId, vote: 1 }),
    });

    // Check state was updated
    expect(setVotes).toHaveBeenCalledTimes(2);
  });

  it('should handle downvote successfully', async () => {
    const docId = 'doc123';
    const votes = {};

    await handleVote(docId, false, votes, setVotes, setVoteError);

    // Check analytics was logged
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'downvote_answer',
      'Engagement',
      docId,
      -1,
    );

    // Check API was called correctly
    expect(fetch).toHaveBeenCalledWith('/api/vote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ docId, vote: -1 }),
    });
  });

  it('should toggle vote on when clicking the same button', async () => {
    const docId = 'doc123';
    const votes = { doc123: 1 }; // Already upvoted

    await handleVote(docId, true, votes, setVotes, setVoteError);

    // Should reset to 0
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'upvote_answer',
      'Engagement',
      docId,
      0,
    );

    // Check API was called correctly to reset vote
    expect(fetch).toHaveBeenCalledWith('/api/vote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ docId, vote: 0 }),
    });
  });

  it('should handle missing docId', async () => {
    await handleVote('', true, {}, setVotes, setVoteError);

    expect(consoleSpy).toHaveBeenCalledWith('Vote error: Missing document ID');
    expect(fetch).not.toHaveBeenCalled();
    expect(setVotes).not.toHaveBeenCalled();
  });

  it('should handle API error', async () => {
    const docId = 'doc123';
    const votes = {};
    const errorMessage = 'Failed to update vote';

    // Mock fetch to return an error
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ message: errorMessage }),
    });

    await handleVote(docId, true, votes, setVotes, setVoteError);

    expect(setVoteError).toHaveBeenCalledWith(errorMessage);
    expect(consoleSpy).toHaveBeenCalledWith('Vote error:', expect.any(Error));

    // Should still update local state first
    expect(setVotes).toHaveBeenCalledTimes(1);
  });

  it('should handle network error and set timeout to clear error', async () => {
    const docId = 'doc123';
    const votes = {};
    const networkError = new Error('Network failure');

    // Mock fetch to throw an error
    (fetch as jest.Mock).mockRejectedValue(networkError);

    await handleVote(docId, true, votes, setVotes, setVoteError);

    // Check initial error state
    expect(setVoteError).toHaveBeenCalledWith('Network failure');
    expect(consoleSpy).toHaveBeenCalledWith('Vote error:', networkError);

    // Clear initial call records to test timeout function
    setVoteError.mockClear();

    // Fast-forward timers to trigger the timeout callback
    jest.runAllTimers();

    // After timeout, error should be cleared
    expect(setVoteError).toHaveBeenCalledWith(null);
  });
});
