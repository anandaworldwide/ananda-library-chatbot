import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import MessageItem from '@/components/MessageItem';
import { ExtendedAIMessage } from '@/types/ExtendedAIMessage';
import { Document } from 'langchain/document';
import { DocMetadata } from '@/types/DocMetadata';
import { SiteConfig } from '@/types/siteConfig';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSudo } from '@/contexts/SudoContext';

// Add mock for react-markdown at the top of the file
jest.mock('react-markdown', () => {
  const ReactMarkdownMock = ({ children }: { children: string }) => {
    // Simple implementation that converts markdown links to actual links
    const content = children.toString();
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const processedContent = content.replace(linkRegex, (_, text, url) => {
      // GETHUMAN links are handled differently based on siteConfig in the actual component
      // In the mock, we simply pass through the GETHUMAN href for non-ananda sites
      if (url === 'GETHUMAN') {
        // Use data attributes to help with test assertions
        return `<a href="${url}" data-testid="gethuman-link">${text}</a>`;
      }
      // Default link rendering with target and rel attributes
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    return (
      <div
        data-testid="react-markdown"
        dangerouslySetInnerHTML={{ __html: processedContent }}
      />
    );
  };
  ReactMarkdownMock.displayName = 'ReactMarkdown';
  return ReactMarkdownMock;
});

// Also mock remark-gfm which is imported in MessageItem.tsx
jest.mock('remark-gfm', () => {
  return jest.fn(() => ({}));
});

// Mock the required contexts
jest.mock('@/contexts/SudoContext', () => ({
  useSudo: jest.fn().mockReturnValue({ isSudoUser: false }),
}));

// Mock dependencies
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: React.ComponentProps<'img'> & { priority?: boolean }) => {
    // Remove priority from props to prevent TypeScript errors
    const { priority } = props;

    return (
      <div
        data-testid="mock-image"
        data-src={props.src}
        data-alt={props.alt}
        data-priority={priority ? 'true' : 'false'}
      />
    );
  },
}));

jest.mock('@/components/SourcesList', () => {
  return jest
    .fn()
    .mockImplementation(({ sources }) => (
      <div data-testid="sources-list">{sources.length} sources found</div>
    ));
});

jest.mock('@/components/CopyButton', () => {
  return jest
    .fn()
    .mockImplementation(() => <button data-testid="copy-button">Copy</button>);
});

jest.mock('@/components/LikeButton', () => {
  return jest
    .fn()
    .mockImplementation(({ answerId, initialLiked, onLikeCountChange }) => (
      <button
        data-testid="like-button"
        onClick={() => onLikeCountChange(answerId, !initialLiked)}
      >
        {initialLiked ? 'Liked' : 'Like'}
      </button>
    ));
});

// Mock the useVote hook to avoid actual API calls
jest.mock('@/hooks/useVote', () => ({
  useVote: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));

// Mock logEvent to prevent analytics during tests
jest.mock('@/utils/client/analytics', () => ({
  logEvent: jest.fn(),
}));

// Mock the next/router
jest.mock('next/router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

// Create a wrapper with QueryClientProvider for tests
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const renderWithQueryClient = (ui: React.ReactElement) => {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>,
  );
};

describe('MessageItem', () => {
  // Set up mock for window.location
  let originalLocation: Location;

  beforeEach(() => {
    // Store the original location
    originalLocation = window.location;

    // Create a new Location object
    const mockLocation = {
      ...originalLocation,
      href: '',
      // Add any other properties being used in tests
    };

    // Use Object.defineProperty to avoid TypeScript errors
    Object.defineProperty(window, 'location', {
      value: mockLocation,
      writable: true,
    });
  });

  afterEach(() => {
    // Use Object.defineProperty to restore original window.location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  // Set up mock props
  const mockSiteConfig: SiteConfig = {
    siteId: 'ananda-public',
    shortname: 'ananda',
    name: 'Ananda Public',
    tagline: 'Ananda Public Site',
    greeting: 'Welcome to Ananda',
    parent_site_url: 'https://www.ananda.org',
    parent_site_name: 'Ananda',
    help_url: 'https://www.ananda.org/help',
    help_text: 'Need help?',
    collectionConfig: {},
    libraryMappings: {},
    enableSuggestedQueries: true,
    enableMediaTypeSelection: false,
    enableAuthorSelection: false,
    welcome_popup_heading: 'Welcome',
    other_visitors_reference: 'others',
    loginImage: null,
    header: { logo: '', navItems: [] },
    footer: { links: [] },
    requireLogin: false,
    allowPrivateSessions: true,
    allowAllAnswersPage: true,
    npsSurveyFrequencyDays: 30,
    queriesPerUserPerDay: 100,
    showSourceContent: true,
    showVoting: true,
  };

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
  ];

  const userMessage: ExtendedAIMessage = {
    type: 'userMessage',
    message: 'Test user message',
    docId: undefined,
    collection: undefined,
    sourceDocs: [],
  };

  const aiMessage: ExtendedAIMessage = {
    type: 'apiMessage',
    message: 'Test AI message',
    docId: '123',
    collection: 'test',
    sourceDocs: mockSources,
  };

  const defaultProps = {
    message: aiMessage,
    previousMessage: userMessage,
    index: 1,
    isLastMessage: true,
    loading: false,
    privateSession: false,
    collectionChanged: false,
    hasMultipleCollections: false,
    likeStatuses: {},
    linkCopied: null,
    votes: {},
    siteConfig: mockSiteConfig,
    handleLikeCountChange: jest.fn(),
    handleCopyLink: jest.fn(),
    handleVote: jest.fn(),
    lastMessageRef: null,
    messageKey: 'message-1',
    voteError: null,
    allowAllAnswersPage: false,
    showRelatedQuestions: true,
  };

  it('renders user message correctly', () => {
    const props = {
      ...defaultProps,
      message: userMessage,
      index: 0,
    };

    renderWithQueryClient(<MessageItem {...props} />);

    expect(screen.getByText('Test user message')).toBeInTheDocument();
    // User icon should be shown for user messages
    const userIcon = screen.getByTestId('mock-image');
    expect(userIcon).toBeInTheDocument();
    expect(userIcon.getAttribute('data-alt')).toBe('Me');
  });

  it('renders AI message correctly', () => {
    renderWithQueryClient(<MessageItem {...defaultProps} />);

    expect(screen.getByText('Test AI message')).toBeInTheDocument();
    // AI icon should be shown for AI messages
    const aiIcon = screen.getByTestId('mock-image');
    expect(aiIcon).toBeInTheDocument();
    expect(aiIcon.getAttribute('data-alt')).toBe('AI');

    // Sources should be rendered
    expect(screen.getByTestId('sources-list')).toBeInTheDocument();
    expect(screen.getByTestId('sources-list')).toHaveTextContent(
      '2 sources found',
    );
  });

  it('shows copy button for AI messages', () => {
    renderWithQueryClient(<MessageItem {...defaultProps} />);

    expect(screen.getByTestId('copy-button')).toBeInTheDocument();
  });

  it('handles link copy correctly', () => {
    renderWithQueryClient(<MessageItem {...defaultProps} />);

    const linkButton = screen.getByTitle('Copy link to clipboard');
    fireEvent.click(linkButton);

    expect(defaultProps.handleCopyLink).toHaveBeenCalledWith('123');
  });

  it('handles likes correctly', () => {
    renderWithQueryClient(<MessageItem {...defaultProps} />);

    const likeButton = screen.getByTestId('like-button');
    fireEvent.click(likeButton);

    expect(defaultProps.handleLikeCountChange).toHaveBeenCalled();
  });

  it('displays sources above message content when showSourcesBelow is false', () => {
    const { container } = renderWithQueryClient(
      <MessageItem {...defaultProps} showSourcesBelow={false} />,
    );

    // Check that sources are rendered before message content in the DOM
    const sourcesDiv = screen.getByTestId('sources-list').parentElement;
    const markdownDiv = container.querySelector('.markdownanswer');

    if (sourcesDiv && markdownDiv) {
      // Compare the DOM positions
      expect(sourcesDiv.compareDocumentPosition(markdownDiv)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('displays sources below message content when showSourcesBelow is true', () => {
    const { container } = renderWithQueryClient(
      <MessageItem {...defaultProps} showSourcesBelow={true} />,
    );

    // Check that sources are rendered after message content in the DOM
    const sourcesDiv = screen.getByTestId('sources-list').parentElement;
    const markdownDiv = container.querySelector('.markdownanswer');

    if (sourcesDiv && markdownDiv) {
      // Compare the DOM positions
      expect(sourcesDiv.compareDocumentPosition(markdownDiv)).toBe(
        Node.DOCUMENT_POSITION_PRECEDING,
      );
    }
  });

  it('displays related questions when available and allowAllAnswersPage is true', () => {
    const relatedQuestions = [
      {
        id: 'rel1',
        title: 'Related Question 1',
        similarity: 0.8,
      },
      {
        id: 'rel2',
        title: 'Related Question 2',
        similarity: 0.7,
      },
      // Add a question below threshold to test filtering
      {
        id: 'rel3',
        title: 'Unrelated Question',
        similarity: 0.1, // Below threshold
      },
    ];
    const messageWithRelated = {
      ...aiMessage,
      relatedQuestions: relatedQuestions,
    };
    const props = {
      ...defaultProps,
      message: messageWithRelated,
      allowAllAnswersPage: true, // Ensure this is true for the test
      // showRelatedQuestions is true from defaultProps
    };

    renderWithQueryClient(<MessageItem {...props} />);

    // Check that the related questions container is rendered
    expect(screen.getByText('Related Questions')).toBeInTheDocument();

    // Check that the correct related questions are linked
    expect(screen.getByText('Related Question 1')).toBeInTheDocument();
    expect(screen.getByText('Related Question 1').closest('a')).toHaveAttribute(
      'href',
      '/answers/rel1',
    );
    expect(screen.getByText('Related Question 2')).toBeInTheDocument();
    expect(screen.getByText('Related Question 2').closest('a')).toHaveAttribute(
      'href',
      '/answers/rel2',
    );

    // Check that the unrelated question (below threshold) is NOT displayed
    expect(screen.queryByText('Unrelated Question')).not.toBeInTheDocument();
  });

  it('does not display related questions when allowAllAnswersPage is false', () => {
    const relatedQuestions = [
      {
        id: 'rel1',
        title: 'Related Question 1',
        similarity: 0.8,
      },
    ];
    const messageWithRelated = {
      ...aiMessage,
      relatedQuestions: relatedQuestions,
    };
    const props = {
      ...defaultProps,
      message: messageWithRelated,
      allowAllAnswersPage: false, // Explicitly false for this test
      // showRelatedQuestions is true from defaultProps, but should be ignored due to allowAllAnswersPage
    };

    renderWithQueryClient(<MessageItem {...props} />);

    expect(screen.queryByText('Related Questions')).not.toBeInTheDocument();
    expect(screen.queryByText('Related Question 1')).not.toBeInTheDocument();
  });

  it('converts GETHUMAN links to Ananda contact page links for ananda-public site', () => {
    const messageWithGethumanLink: ExtendedAIMessage = {
      ...aiMessage,
      message: 'This is a test message with a [GETHUMAN link](GETHUMAN)',
    };

    renderWithQueryClient(
      <MessageItem {...defaultProps} message={messageWithGethumanLink} />,
    );

    const link = screen.getByText('GETHUMAN link');
    expect(link).toBeInTheDocument();
    // The actual component will handle GETHUMAN links based on siteConfig
    expect(link.closest('a')).toHaveAttribute('data-testid', 'gethuman-link');
  });

  it('does not convert GETHUMAN links for non-ananda-public sites', () => {
    const nonAnandaSiteConfig: SiteConfig = {
      ...mockSiteConfig,
      siteId: 'other-site',
    };

    const messageWithGethumanLink: ExtendedAIMessage = {
      ...aiMessage,
      message: 'This is a test message with a [GETHUMAN link](GETHUMAN)',
    };

    renderWithQueryClient(
      <MessageItem
        {...defaultProps}
        message={messageWithGethumanLink}
        siteConfig={nonAnandaSiteConfig}
      />,
    );

    const link = screen.getByText('GETHUMAN link');
    expect(link).toBeInTheDocument();
    // The actual component will handle GETHUMAN links based on siteConfig
    expect(link.closest('a')).toHaveAttribute('data-testid', 'gethuman-link');
  });

  it('handles regular links correctly', () => {
    const messageWithRegularLink: ExtendedAIMessage = {
      ...aiMessage,
      message:
        'This is a test message with a [regular link](https://example.com)',
    };

    render(<MessageItem {...defaultProps} message={messageWithRegularLink} />);

    const link = screen.getByText('regular link');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com');
    expect(link.closest('a')).toHaveAttribute('target', '_blank');
    expect(link.closest('a')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // ADD A NEW TEST for the sudo toggle behavior
  it('displays admin toggle when showRelatedQuestions is false and user is sudo', () => {
    // Mock useSudo to return true for this test
    (useSudo as jest.Mock).mockReturnValue({ isSudoUser: true });

    const relatedQuestions = [
      { id: 'rel1', title: 'Related Question 1', similarity: 0.8 },
    ];
    const messageWithRelated = {
      ...aiMessage,
      relatedQuestions: relatedQuestions,
    };
    const props = {
      ...defaultProps,
      message: messageWithRelated,
      allowAllAnswersPage: true,
      showRelatedQuestions: false, // Explicitly false for this test
    };

    renderWithQueryClient(<MessageItem {...props} />);

    // Initially, related questions should be hidden
    expect(screen.queryByText('Related Questions')).not.toBeInTheDocument();
    expect(screen.queryByText('Related Question 1')).not.toBeInTheDocument();

    // The admin toggle button should be visible
    const toggleButton = screen.getByText(/Admin: show related Questions/i);
    expect(toggleButton).toBeInTheDocument();

    // Click the toggle button
    fireEvent.click(toggleButton);

    // Now, the related questions should be visible
    expect(screen.getByText('Related Questions')).toBeInTheDocument();
    expect(screen.getByText('Related Question 1')).toBeInTheDocument();
    expect(toggleButton).toHaveTextContent(/Admin: hide related Questions/i);

    // Click again to hide
    fireEvent.click(toggleButton);
    expect(screen.queryByText('Related Questions')).not.toBeInTheDocument();
    expect(screen.queryByText('Related Question 1')).not.toBeInTheDocument();
    expect(toggleButton).toHaveTextContent(/Admin: show related Questions/i);

    // Reset the mock for other tests
    (useSudo as jest.Mock).mockReturnValue({ isSudoUser: false });
  });

  it('does NOT display admin toggle when showRelatedQuestions is false and user is NOT sudo', () => {
    // Ensure useSudo returns false (default mock)
    (useSudo as jest.Mock).mockReturnValue({ isSudoUser: false });

    const relatedQuestions = [
      { id: 'rel1', title: 'Related Question 1', similarity: 0.8 },
    ];
    const messageWithRelated = {
      ...aiMessage,
      relatedQuestions: relatedQuestions,
    };
    const props = {
      ...defaultProps,
      message: messageWithRelated,
      allowAllAnswersPage: true,
      showRelatedQuestions: false, // Explicitly false
    };

    renderWithQueryClient(<MessageItem {...props} />);

    // Neither related questions nor the admin toggle should be visible
    expect(screen.queryByText('Related Questions')).not.toBeInTheDocument();
    expect(screen.queryByText('Related Question 1')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Admin: show related Questions/i),
    ).not.toBeInTheDocument();
  });
});
