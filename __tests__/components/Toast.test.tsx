import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import Toast from '@/components/Toast';

jest.useFakeTimers();

describe('Toast Component', () => {
  it('renders the toast with the provided message', () => {
    const mockOnClose = jest.fn();
    render(<Toast message="Test message" onClose={mockOnClose} />);

    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('calls onClose after the timeout expires', async () => {
    const mockOnClose = jest.fn();
    render(<Toast message="Test message" onClose={mockOnClose} />);

    expect(mockOnClose).not.toHaveBeenCalled();

    // Fast-forward time
    jest.advanceTimersByTime(3000);

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it('cleans up timeout on unmount', () => {
    const mockOnClose = jest.fn();
    const { unmount } = render(
      <Toast message="Test message" onClose={mockOnClose} />,
    );

    // Spy on clearTimeout
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
