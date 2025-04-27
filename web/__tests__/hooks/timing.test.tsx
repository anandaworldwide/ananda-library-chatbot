import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useCallback, useState } from 'react';

// Mock timing metrics formatter function extracted from pages/index.tsx
const formatTimingMetrics = (
  timingMetrics: {
    ttfb?: number;
    total?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
  } | null,
) => {
  if (!timingMetrics) return null;

  const { ttfb, tokensPerSecond, totalTokens } = timingMetrics;

  if (ttfb === undefined || tokensPerSecond === undefined) return null;

  const ttfbSecs = (ttfb / 1000).toFixed(2);
  return `${ttfbSecs} secs to first character, then ${tokensPerSecond} chars/sec streamed (${totalTokens} total)`;
};

// Simple component to test the formatting
const TimingDisplay = ({
  timing,
}: {
  timing: {
    ttfb?: number;
    total?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
  } | null;
}) => {
  const formattedTiming = formatTimingMetrics(timing);
  if (!formattedTiming) return null;
  return <div data-testid="timing-display">{formattedTiming}</div>;
};

describe('Timing Metrics Display', () => {
  test('formats timing metrics correctly', () => {
    const timingData = {
      ttfb: 1500, // 1.5 seconds
      total: 5000, // 5 seconds
      tokensPerSecond: 50,
      totalTokens: 175,
    };

    render(<TimingDisplay timing={timingData} />);

    // The formatted string should be: "1.50 secs to first character, then 50 chars/sec streamed (175 total)"
    const display = screen.getByTestId('timing-display');
    expect(display).toHaveTextContent(
      '1.50 secs to first character, then 50 chars/sec streamed (175 total)',
    );
  });

  test('handles null timing data', () => {
    render(<TimingDisplay timing={null} />);

    // The component should not render anything
    const display = screen.queryByTestId('timing-display');
    expect(display).not.toBeInTheDocument();
  });

  test('handles incomplete timing data', () => {
    // Missing tokensPerSecond
    const incompleteData = {
      ttfb: 1500,
      total: 5000,
      totalTokens: 175,
    };

    render(<TimingDisplay timing={incompleteData} />);

    // The component should not render anything
    const display = screen.queryByTestId('timing-display');
    expect(display).not.toBeInTheDocument();
  });

  test('handles edge cases: zero values', () => {
    const zeroData = {
      ttfb: 0,
      total: 1000,
      tokensPerSecond: 0,
      totalTokens: 0,
    };

    render(<TimingDisplay timing={zeroData} />);

    // Even with zeros, it should display
    const display = screen.getByTestId('timing-display');
    expect(display).toHaveTextContent(
      '0.00 secs to first character, then 0 chars/sec streamed (0 total)',
    );
  });

  test('handles edge cases: extremely large values', () => {
    const largeData = {
      ttfb: 10000, // 10 seconds
      total: 60000, // 1 minute
      tokensPerSecond: 9999,
      totalTokens: 500000,
    };

    render(<TimingDisplay timing={largeData} />);

    // It should format large values correctly
    const display = screen.getByTestId('timing-display');
    expect(display).toHaveTextContent(
      '10.00 secs to first character, then 9999 chars/sec streamed (500000 total)',
    );
  });
});

// Test that timing metrics work correctly in a stateful component
const StatefulTimingComponent = () => {
  const [timingMetrics, setTimingMetrics] = useState<{
    ttfb?: number;
    total?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
  } | null>(null);

  const updateTiming = useCallback(() => {
    setTimingMetrics({
      ttfb: 2000,
      total: 8000,
      tokensPerSecond: 100,
      totalTokens: 600,
    });
  }, []);

  return (
    <div>
      <button onClick={updateTiming} data-testid="update-timing">
        Update Timing
      </button>
      {timingMetrics && (
        <div data-testid="timing-display">
          {formatTimingMetrics(timingMetrics)}
        </div>
      )}
    </div>
  );
};

describe('Stateful Timing Component', () => {
  test('updates timing metrics correctly', async () => {
    render(<StatefulTimingComponent />);

    // Initially no timing display
    expect(screen.queryByTestId('timing-display')).not.toBeInTheDocument();

    // Update timing (wrapped in act)
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-timing'));
      // Small delay to ensure the state update completes
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Now timing display should be shown
    const display = screen.getByTestId('timing-display');
    expect(display).toBeInTheDocument();
    expect(display).toHaveTextContent(
      '2.00 secs to first character, then 100 chars/sec streamed (600 total)',
    );
  });
});
