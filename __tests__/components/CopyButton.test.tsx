import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import CopyButton from '@/components/CopyButton';
import { copyTextToClipboard } from '@/utils/client/clipboard';
import { logEvent } from '@/utils/client/analytics';
import { Document } from 'langchain/document';
import { DocMetadata } from '@/types/DocMetadata';
import { SiteConfig } from '@/types/siteConfig';

// Mock the dependencies
jest.mock('@/utils/client/clipboard', () => ({
  copyTextToClipboard: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/utils/client/analytics', () => ({
  logEvent: jest.fn(),
}));

// Mock environment variable
process.env.NEXT_PUBLIC_BASE_URL = 'https://test.com';

describe('CopyButton', () => {
  const mockSources: Document<DocMetadata>[] = [
    {
      pageContent: 'test content 1',
      metadata: {
        title: 'Test Doc 1',
        type: 'text',
        library: 'Test Library',
        source: 'https://test.com/doc1',
      },
    },
    {
      pageContent: 'test content 2',
      metadata: {
        title: 'Test Doc 2',
        type: 'text',
        library: 'Test Library',
      },
    },
    {
      pageContent: 'test content 3',
      metadata: {
        title: 'Unknown Doc',
        type: 'text',
        library: 'Test Library',
      },
    },
  ];

  const mockSiteConfig: SiteConfig = {
    siteId: 'test',
    name: 'Test Site',
    shortname: 'Test',
    tagline: 'Test Tagline',
    greeting: 'Test Greeting',
    parent_site_url: '',
    parent_site_name: '',
    help_url: '',
    help_text: '',
    collectionConfig: {},
    libraryMappings: {},
    enableSuggestedQueries: false,
    enableMediaTypeSelection: false,
    enableAuthorSelection: false,
    welcome_popup_heading: '',
    other_visitors_reference: '',
    loginImage: null,
    header: { logo: '', navItems: [] },
    footer: { links: [] },
    requireLogin: true,
    allowPrivateSessions: false,
    allowAllAnswersPage: false,
    npsSurveyFrequencyDays: 30,
    queriesPerUserPerDay: 100,
  };

  const mockProps = {
    markdown: 'Test markdown',
    answerId: '123',
    question: 'Test question',
    siteConfig: null,
    sources: mockSources,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders copy icon by default', () => {
    const { getByTitle } = render(<CopyButton {...mockProps} />);
    const button = getByTitle('Copy answer to clipboard');
    expect(button).toBeInTheDocument();
    expect(button.querySelector('.material-icons')).toHaveTextContent(
      'content_copy',
    );
  });

  it('changes to check icon when clicked', async () => {
    const { getByTitle } = render(<CopyButton {...mockProps} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(button.querySelector('.material-icons')).toHaveTextContent(
        'check',
      );
    });

    // Wait for icon to change back
    await waitFor(
      () => {
        expect(button.querySelector('.material-icons')).toHaveTextContent(
          'content_copy',
        );
      },
      { timeout: 1100 },
    );
  });

  it('formats sources correctly with URLs', async () => {
    const { getByTitle } = render(<CopyButton {...mockProps} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining(
        '<a href="https://test.com/doc1">Test Doc 1</a> (Test Library)',
      ),
      true,
    );
  });

  it('formats sources correctly without URLs', async () => {
    const { getByTitle } = render(<CopyButton {...mockProps} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('Test Doc 2 (Test Library)'),
      true,
    );
  });

  it('uses "Unknown source" for missing titles', async () => {
    const sourceWithoutTitle: Document<DocMetadata> = {
      pageContent: 'test content',
      metadata: {
        title: '', // Empty title will trigger the "Unknown source" fallback
        type: 'text',
        library: 'Test Library',
      },
    };
    const propsWithoutTitle = {
      ...mockProps,
      sources: [sourceWithoutTitle],
    };
    const { getByTitle } = render(<CopyButton {...propsWithoutTitle} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('Unknown source (Test Library)'),
      true,
    );
  });

  it('handles missing library metadata', async () => {
    const sourceWithoutLibrary: Document<DocMetadata> = {
      pageContent: 'test content',
      metadata: {
        title: 'Test Doc',
        type: 'text',
        library: '', // Empty library should be handled gracefully
      },
    };
    const propsWithoutLibrary = {
      ...mockProps,
      sources: [sourceWithoutLibrary],
    };
    const { getByTitle } = render(<CopyButton {...propsWithoutLibrary} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('Test Doc ()'),
      true,
    );
  });

  it('skips sources section when hideSources is true', async () => {
    const propsWithHiddenSources = {
      ...mockProps,
      siteConfig: { ...mockSiteConfig, hideSources: true },
    };
    const { getByTitle } = render(<CopyButton {...propsWithHiddenSources} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.not.stringContaining('Sources'),
      true,
    );
  });

  it('uses "unknown" for undefined answerId in analytics', async () => {
    const propsWithoutId = {
      ...mockProps,
      answerId: undefined,
    };
    const { getByTitle } = render(<CopyButton {...propsWithoutId} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(logEvent).toHaveBeenCalledWith('copy_answer', 'UI', 'unknown');
  });

  it('includes question and answer in copied content', async () => {
    const { getByTitle } = render(<CopyButton {...mockProps} />);
    const button = getByTitle('Copy answer to clipboard');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('<h2 id="question">Question:</h2>'),
      true,
    );
    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('<p>Test question</p>'),
      true,
    );
    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('<h2 id="answer">Answer:</h2>'),
      true,
    );
    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('<p>Test markdown</p>'),
      true,
    );
  });
});
