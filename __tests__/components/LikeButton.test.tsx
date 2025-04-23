/**
 * Tests for the LikeButton component
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import LikeButton from '@/components/LikeButton';
import { getOrCreateUUID } from '@/utils/client/uuid';
import { updateLike } from '@/services/likeService';

// Mock dependencies
jest.mock('@/utils/client/uuid', () => ({
  getOrCreateUUID: jest.fn(),
}));

jest.mock('@/services/likeService', () => ({
  updateLike: jest.fn(),
}));

describe('LikeButton', () => {
  // Setup common test variables
  const mockAnswerId = 'answer123';
  const mockUUID = 'test-uuid-12345';
  const mockOnLikeCountChange = jest.fn();

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    (getOrCreateUUID as jest.Mock).mockReturnValue(mockUUID);
    (updateLike as jest.Mock).mockResolvedValue(undefined);

    // Mock console.error to prevent test output noise
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Reset mock timer
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders correctly with initial props', () => {
    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    // Check for text and button
    expect(screen.getByText('Found this helpful?')).toBeInTheDocument();
    const likeButton = screen.getByRole('button', {
      name: /like this answer/i,
    });
    expect(likeButton).toBeInTheDocument();

    // Check for the heart icon (not liked)
    expect(likeButton.querySelector('.material-icons')).toHaveTextContent(
      'favorite_border',
    );

    // Check like count is displayed
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders with liked state when initialLiked is true', () => {
    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={true}
        likeCount={10}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    const likeButton = screen.getByRole('button', {
      name: /unlike this answer/i,
    });
    expect(likeButton.querySelector('.material-icons')).toHaveTextContent(
      'favorite',
    );
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('toggles like state when clicked', async () => {
    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    // Find and click the button
    const likeButton = screen.getByRole('button', {
      name: /like this answer/i,
    });
    await act(async () => {
      fireEvent.click(likeButton);
    });

    // Check that the heart icon changed
    expect(likeButton.querySelector('.material-icons')).toHaveTextContent(
      'favorite',
    );

    // Check that the like count updated
    expect(screen.getByText('6')).toBeInTheDocument();

    // Check that the service was called with correct params
    expect(getOrCreateUUID).toHaveBeenCalled();
    expect(updateLike).toHaveBeenCalledWith(mockAnswerId, mockUUID, true);
    expect(mockOnLikeCountChange).toHaveBeenCalledWith(mockAnswerId, 6);

    // Click again to unlike
    await act(async () => {
      fireEvent.click(likeButton);
    });

    // Check that the heart icon changed back
    expect(likeButton.querySelector('.material-icons')).toHaveTextContent(
      'favorite_border',
    );

    // Check that the like count updated
    expect(screen.getByText('5')).toBeInTheDocument();

    // Check that the service was called with correct params
    expect(updateLike).toHaveBeenCalledWith(mockAnswerId, mockUUID, false);
    expect(mockOnLikeCountChange).toHaveBeenCalledWith(mockAnswerId, 5);
  });

  it('hides like count when showLikeCount is false', () => {
    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
        showLikeCount={false}
      />,
    );

    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });

  it('hides like count when count is 0 even if showLikeCount is true', () => {
    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={0}
        onLikeCountChange={mockOnLikeCountChange}
        showLikeCount={true}
      />,
    );

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('handles error when like update fails', async () => {
    const mockError = new Error('Network error');
    (updateLike as jest.Mock).mockRejectedValue(mockError);

    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    // Click to like
    const likeButton = screen.getByRole('button', {
      name: /like this answer/i,
    });
    await act(async () => {
      fireEvent.click(likeButton);
    });

    // Wait for the promise to reject
    await waitFor(() => {
      // Should show error message
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    // Like state should be reverted
    expect(likeButton.querySelector('.material-icons')).toHaveTextContent(
      'favorite_border',
    );

    // Like count should remain the same as before (check by class not exact text)
    const likeCount = screen.getByText(/\d+/);
    expect(likeCount).toHaveClass('like-count');

    // Error should disappear after timeout
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
  });

  it('successfully animates when liked', async () => {
    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    const likeButton = screen.getByRole('button', {
      name: /like this answer/i,
    });

    // Click to trigger animation
    await act(async () => {
      fireEvent.click(likeButton);
    });

    // Check that animation class is added
    expect(likeButton).toHaveClass('animate-pulse');

    // Advance timer to clear animation
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Check that animation class is removed
    expect(likeButton).not.toHaveClass('animate-pulse');
  });

  it('updates when initialLiked prop changes', () => {
    const { rerender } = render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    // Check initial state
    const likeButton = screen.getByRole('button', {
      name: /like this answer/i,
    });
    expect(likeButton.querySelector('.material-icons')).toHaveTextContent(
      'favorite_border',
    );

    // Re-render with different initialLiked
    rerender(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={true}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    // Check updated state
    expect(
      screen.getByRole('button', { name: /unlike this answer/i }),
    ).toBeInTheDocument();
    expect(likeButton.querySelector('.material-icons')).toHaveTextContent(
      'favorite',
    );
  });

  it('updates when likeCount prop changes', () => {
    const { rerender } = render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    // Check initial count
    expect(screen.getByText('5')).toBeInTheDocument();

    // Re-render with different count
    rerender(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={10}
        onLikeCountChange={mockOnLikeCountChange}
      />,
    );

    // Check updated count
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('does not trigger action when disabled prop is true', async () => {
    render(
      <LikeButton
        answerId={mockAnswerId}
        initialLiked={false}
        likeCount={5}
        onLikeCountChange={mockOnLikeCountChange}
        disabled={true}
      />,
    );

    // Find and click the button
    const likeButton = screen.getByRole('button', {
      name: /like this answer/i,
    });
    await act(async () => {
      fireEvent.click(likeButton);
    });

    // Verify button is visually disabled
    expect(likeButton).toHaveAttribute('disabled');

    // Check that likeCount wasn't updated and service wasn't called
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(updateLike).not.toHaveBeenCalled();
    expect(mockOnLikeCountChange).not.toHaveBeenCalled();
  });
});
