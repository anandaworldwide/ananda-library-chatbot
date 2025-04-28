/**
 * Utility Function Test Template
 *
 * Use this template for testing utility functions. Replace the placeholders with actual
 * function details and implement the test cases relevant to your utility.
 */

import { yourUtilityFunction } from '@/utils/your-directory/your-utility';

// Mock any dependencies
jest.mock('@/utils/client/analytics', () => ({
  logEvent: jest.fn(),
}));

// Import dependencies after mocking
import * as analytics from '@/utils/client/analytics';

// Mock global objects if needed
global.fetch = jest.fn() as jest.Mock;

describe('yourUtilityFunction', () => {
  // Define test variables
  let mockParam1: string;
  let mockParam2: Record<string, any>;
  let mockCallback: jest.Mock;
  let mockErrorHandler: jest.Mock;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Initialize test variables
    mockParam1 = 'test-id';
    mockParam2 = { key: 'value' };
    mockCallback = jest.fn();
    mockErrorHandler = jest.fn();

    // Setup console spy to avoid actual console logs/errors in tests
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    // Mock any API responses
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    // Enable fake timers if testing timeouts
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Cleanup spies
    consoleSpy.mockRestore();

    // Restore real timers
    jest.useRealTimers();
  });

  // Basic success case
  it('successfully processes data with valid inputs', async () => {
    // Call the function
    await yourUtilityFunction(
      mockParam1,
      mockParam2,
      mockCallback,
      mockErrorHandler,
    );

    // Check if the function had the expected effect
    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'value' }),
    );

    // Check if API was called with correct parameters
    expect(fetch).toHaveBeenCalledWith('/api/endpoint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: mockParam1, data: mockParam2 }),
    });

    // Check if analytics was tracked
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'action_name',
      'Category',
      mockParam1,
      expect.any(Number),
    );
  });

  // Error handling
  it('handles errors gracefully', async () => {
    // Mock API error
    const errorMessage = 'API Error';
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ message: errorMessage }),
    });

    // Call the function
    await yourUtilityFunction(
      mockParam1,
      mockParam2,
      mockCallback,
      mockErrorHandler,
    );

    // Check error handling
    expect(mockErrorHandler).toHaveBeenCalledWith(errorMessage);
    expect(consoleSpy).toHaveBeenCalledWith('Error:', expect.any(Error));
  });

  // Network failure
  it('handles network failures', async () => {
    // Mock network error
    const networkError = new Error('Network failure');
    (fetch as jest.Mock).mockRejectedValue(networkError);

    // Call the function
    await yourUtilityFunction(
      mockParam1,
      mockParam2,
      mockCallback,
      mockErrorHandler,
    );

    // Check network error handling
    expect(mockErrorHandler).toHaveBeenCalledWith('Network failure');
    expect(consoleSpy).toHaveBeenCalledWith('Error:', networkError);
  });

  // Invalid input
  it('validates inputs correctly', async () => {
    // Call with invalid input
    await yourUtilityFunction('', mockParam2, mockCallback, mockErrorHandler);

    // Check validation behavior
    expect(mockCallback).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Error: Invalid input');
  });

  // Timeout behavior
  it('clears error after timeout', async () => {
    // Mock error to trigger timeout
    (fetch as jest.Mock).mockRejectedValue(new Error('Timeout test'));

    // Call the function
    await yourUtilityFunction(
      mockParam1,
      mockParam2,
      mockCallback,
      mockErrorHandler,
    );

    // Initial error state
    expect(mockErrorHandler).toHaveBeenCalledWith('Timeout test');

    // Clear previous calls to validate only new ones
    mockErrorHandler.mockClear();

    // Fast-forward timer
    jest.runAllTimers();

    // Check if error was cleared
    expect(mockErrorHandler).toHaveBeenCalledWith(null);
  });

  // Toggle behavior (if applicable)
  it('toggles state when called with the same parameters', async () => {
    // Setup initial state
    mockParam2 = { id: 'test-id', state: 1 };

    // First call
    await yourUtilityFunction(
      mockParam1,
      mockParam2,
      mockCallback,
      mockErrorHandler,
    );

    // Second call with same parameters should toggle
    await yourUtilityFunction(
      mockParam1,
      mockParam2,
      mockCallback,
      mockErrorHandler,
    );

    // Check toggle behavior
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/endpoint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: mockParam1, state: 0 }), // Toggled state
    });
  });
});
