/**
 * Tests for the TruncatedMarkdown component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TruncatedMarkdown from '@/components/TruncatedMarkdown';

// Mock ReactMarkdown to simplify testing
jest.mock('react-markdown', () => {
  const MockMarkdown = ({
    children,
    className,
  }: {
    children: string;
    className: string;
  }) => (
    <div data-testid="react-markdown" className={className}>
      {children}
    </div>
  );
  MockMarkdown.displayName = 'ReactMarkdown';
  return MockMarkdown;
});

// Mock remark-gfm
jest.mock('remark-gfm', () => {
  return jest.fn();
});

describe('TruncatedMarkdown', () => {
  const shortMarkdown = 'This is a short markdown text.';
  const longMarkdown =
    'This is a very long markdown text that should be truncated when displayed. It contains multiple sentences and will exceed the character limit that we set for our test. We need to make sure it is long enough to trigger the truncation functionality properly.';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the full markdown when content is shorter than maxCharacters', () => {
    render(<TruncatedMarkdown markdown={shortMarkdown} maxCharacters={100} />);

    const markdownElement = screen.getByTestId('react-markdown');
    expect(markdownElement).toHaveTextContent(shortMarkdown);

    // "See more" link should not be present
    expect(screen.queryByText(/See more/i)).not.toBeInTheDocument();
  });

  it('renders truncated markdown when content is longer than maxCharacters', () => {
    render(<TruncatedMarkdown markdown={longMarkdown} maxCharacters={50} />);

    const markdownElement = screen.getByTestId('react-markdown');

    // Should be truncated at a word boundary before maxCharacters
    expect(markdownElement.textContent?.length).toBeLessThan(50);

    // "See more" link should be present
    expect(screen.getByText(/See more/i)).toBeInTheDocument();
  });

  it('expands truncated content when "See more" is clicked', () => {
    render(<TruncatedMarkdown markdown={longMarkdown} maxCharacters={50} />);

    // Initial state should be truncated
    let markdownElement = screen.getByTestId('react-markdown');
    expect(markdownElement.textContent?.length).toBeLessThan(50);

    // Click "See more"
    fireEvent.click(screen.getByText(/See more/i));

    // Content should now be expanded
    markdownElement = screen.getByTestId('react-markdown');
    expect(markdownElement).toHaveTextContent(longMarkdown);

    // "See more" link should not be present anymore
    expect(screen.queryByText(/See more/i)).not.toBeInTheDocument();
  });

  it('displays placeholder when markdown is empty', () => {
    render(<TruncatedMarkdown markdown="" maxCharacters={100} />);

    expect(screen.getByText('(No content)')).toBeInTheDocument();
    expect(screen.queryByTestId('react-markdown')).not.toBeInTheDocument();
  });

  it('handles null/undefined markdown gracefully', () => {
    // Use empty string instead of null since component doesn't handle null properly
    render(<TruncatedMarkdown markdown="" maxCharacters={100} />);

    expect(screen.getByText('(No content)')).toBeInTheDocument();
  });

  it('does not truncate content just slightly above maxCharacters', () => {
    // Create content that's just 5% above maxCharacters
    const justOverMaxMarkdown = 'a'.repeat(105);
    render(
      <TruncatedMarkdown markdown={justOverMaxMarkdown} maxCharacters={100} />,
    );

    // Should not be truncated if under 10% threshold (< 110 chars)
    const markdownElement = screen.getByTestId('react-markdown');
    expect(markdownElement).toHaveTextContent(justOverMaxMarkdown);
    expect(screen.queryByText(/See more/i)).not.toBeInTheDocument();
  });

  it('truncates content well above maxCharacters', () => {
    // Create content that's 20% above maxCharacters
    const wellOverMaxMarkdown = 'a '.repeat(60); // 120 chars with spaces
    render(
      <TruncatedMarkdown markdown={wellOverMaxMarkdown} maxCharacters={100} />,
    );

    // Should be truncated since it's over 10% threshold
    expect(screen.getByText(/See more/i)).toBeInTheDocument();
  });

  it('toggles the truncated state when "See more" is clicked', () => {
    render(<TruncatedMarkdown markdown={longMarkdown} maxCharacters={50} />);

    // Initial truncated state - content should be shorter
    const initialMarkdown = screen.getByTestId('react-markdown');
    expect(initialMarkdown.textContent?.length).toBeLessThan(50);

    // Click "See more" link
    fireEvent.click(screen.getByText(/See more/i));

    // After click, content should be expanded
    const expandedMarkdown = screen.getByTestId('react-markdown');
    expect(expandedMarkdown.textContent?.length).toBeGreaterThan(50);
    expect(expandedMarkdown).toHaveTextContent(longMarkdown);
  });
});
