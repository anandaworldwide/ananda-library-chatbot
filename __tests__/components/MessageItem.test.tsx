import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import MessageItem from '@/components/MessageItem';
import { ExtendedAIMessage } from '@/types/ExtendedAIMessage';
import { Document } from 'langchain/document';
import { DocMetadata } from '@/types/DocMetadata';
import { SiteConfig } from '@/types/siteConfig';

// Add mock for react-markdown at the top of the file
jest.mock('react-markdown', () => {
  const ReactMarkdownMock = ({ children }: { children: string }) => (
    <div>{children}</div>
  );
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

describe('MessageItem', () => {
  // Set up mock props
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
  };

  it('renders user message correctly', () => {
    const props = {
      ...defaultProps,
      message: userMessage,
      index: 0,
    };

    render(<MessageItem {...props} />);

    expect(screen.getByText('Test user message')).toBeInTheDocument();
    // User icon should be shown for user messages
    const userIcon = screen.getByTestId('mock-image');
    expect(userIcon).toBeInTheDocument();
    expect(userIcon.getAttribute('data-alt')).toBe('Me');
  });

  it('renders AI message correctly', () => {
    render(<MessageItem {...defaultProps} />);

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
    render(<MessageItem {...defaultProps} />);

    expect(screen.getByTestId('copy-button')).toBeInTheDocument();
  });

  it('handles link copy correctly', () => {
    render(<MessageItem {...defaultProps} />);

    const linkButton = screen.getByTitle('Copy link to clipboard');
    fireEvent.click(linkButton);

    expect(defaultProps.handleCopyLink).toHaveBeenCalledWith('123');
  });

  it('handles likes correctly', () => {
    render(<MessageItem {...defaultProps} />);

    const likeButton = screen.getByTestId('like-button');
    fireEvent.click(likeButton);

    expect(defaultProps.handleLikeCountChange).toHaveBeenCalled();
  });

  it('displays sources above message content when showSourcesBelow is false', () => {
    const { container } = render(
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
    const { container } = render(
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
    const relatedQuestionsMessage: ExtendedAIMessage = {
      ...aiMessage,
      relatedQuestions: [
        { id: 'q1', title: 'Related Question 1', similarity: 0.8 },
        { id: 'q2', title: 'Related Question 2', similarity: 0.5 },
      ],
    };

    const props = {
      ...defaultProps,
      message: relatedQuestionsMessage,
      allowAllAnswersPage: true,
    };

    render(<MessageItem {...props} />);

    expect(screen.getByText('Related Questions')).toBeInTheDocument();
    expect(screen.getByText('Related Question 1')).toBeInTheDocument();
    expect(screen.getByText('Related Question 2')).toBeInTheDocument();
  });

  it('does not display related questions when allowAllAnswersPage is false', () => {
    const relatedQuestionsMessage: ExtendedAIMessage = {
      ...aiMessage,
      relatedQuestions: [
        { id: 'q1', title: 'Related Question 1', similarity: 0.8 },
        { id: 'q2', title: 'Related Question 2', similarity: 0.5 },
      ],
    };

    const props = {
      ...defaultProps,
      message: relatedQuestionsMessage,
      allowAllAnswersPage: false,
    };

    render(<MessageItem {...props} />);

    expect(screen.queryByText('Related Questions')).not.toBeInTheDocument();
  });
});
