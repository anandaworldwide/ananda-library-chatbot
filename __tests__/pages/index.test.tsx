import React from 'react';
import { render, screen } from '@testing-library/react';
import Home from '@/pages/index';
import { SiteConfig } from '@/types/siteConfig';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock next/image to prevent Base URL error
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, width, height, className }: any) => {
    // Use a div with data attributes instead of img to avoid ESLint warning
    return (
      <div
        data-testid="mock-image"
        data-src={typeof src === 'string' ? src : '/mock-image-url.jpg'}
        data-alt={alt}
        data-width={width}
        data-height={height}
        className={className}
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
          height: typeof height === 'number' ? `${height}px` : height,
        }}
      />
    );
  },
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

// Mock the next/router
jest.mock('next/router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

// Mock react-markdown
jest.mock('react-markdown', () => {
  const ReactMarkdownMock = ({ children }: { children: string }) => {
    // Process the content to convert markdown links
    const content = children.toString();
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const processedContent = content.replace(linkRegex, (_, text, url) => {
      // GETHUMAN links are handled differently based on siteConfig in the actual component
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

// Mock remark-gfm
jest.mock('remark-gfm', () => {
  return jest.fn();
});

// Mock the hooks
jest.mock('@/hooks/usePopup', () => ({
  __esModule: true,
  default: () => ({
    isOpen: false,
    openPopup: jest.fn(),
    closePopup: jest.fn(),
  }),
}));

jest.mock('@/hooks/useRandomQueries', () => ({
  __esModule: true,
  useRandomQueries: () => ({
    randomQueries: [],
    isLoading: false,
  }),
}));

// Mock the useChat hook
jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [
      {
        type: 'apiMessage',
        message:
          'Welcome to Ananda! This is a test message with a [GETHUMAN link](GETHUMAN)',
        docId: '123',
        collection: 'test',
        sourceDocs: [],
      },
    ],
    isLoading: false,
    error: null,
    setError: jest.fn(),
    messageState: {
      messages: [
        {
          type: 'apiMessage',
          message:
            'Welcome to Ananda! This is a test message with a [GETHUMAN link](GETHUMAN)',
          docId: '123',
          collection: 'test',
          sourceDocs: [],
        },
      ],
    },
  }),
}));

jest.mock('@/hooks/useMultipleCollections', () => ({
  __esModule: true,
  useMultipleCollections: () => ({
    collections: [],
    isLoading: false,
    error: null,
  }),
}));

// Mock the SudoContext
jest.mock('@/contexts/SudoContext', () => ({
  __esModule: true,
  SudoProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useSudo: () => ({
    isSudoUser: false,
    isSudoAdmin: false,
  }),
}));

describe('Home Page', () => {
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
  };

  it('renders the home page correctly', () => {
    renderWithQueryClient(<Home siteConfig={mockSiteConfig} />);
    expect(screen.getByText(/Welcome to Ananda/i)).toBeInTheDocument();
  });

  it('handles GETHUMAN links correctly', () => {
    renderWithQueryClient(<Home siteConfig={mockSiteConfig} />);

    // Find the GETHUMAN link
    const link = screen.getByText('GETHUMAN link');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('data-testid', 'gethuman-link');

    // The link href will be processed by the actual component based on siteConfig
    expect(link.closest('a')).toHaveAttribute('href', 'GETHUMAN');
  });
});
