/**
 * AuthGuard Component Tests
 *
 * Tests for the AuthGuard component that prevents content flash during authentication checks
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import { useRouter } from "next/router";
import AuthGuard from "@/components/AuthGuard";
import { isPublicPage } from "@/utils/client/authConfig";

// Mock dependencies
jest.mock("next/router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/utils/client/authConfig", () => ({
  isPublicPage: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

describe("AuthGuard", () => {
  const mockPush = jest.fn();
  const mockReplace = jest.fn();
  const mockRouter = {
    asPath: "/",
    isReady: true,
    push: mockPush,
    replace: mockReplace,
  };

  const mockSiteConfig = {
    siteId: "test",
    shortname: "Test",
    name: "Test Site",
    tagline: "Test tagline",
    greeting: "Test greeting",
    requireLogin: true,
    parent_site_url: "https://example.com",
    parent_site_name: "Example",
    help_url: "https://example.com/help",
    help_text: "Help",
    enableGeoAwareness: false,
    excludedAccessLevels: [],
    accessLevelPathMap: {},
    pineconeNamespace: "test",
    systemPromptFile: "test.txt",
    systemPromptData: {},
    enableChatHistory: true,
    enableRelatedQuestions: true,
    enableSourceCitations: true,
    enableAudioPlayer: false,
    enableDownloadPdf: false,
    enableNPS: false,
    enableLikeButtons: true,
    enableFeedback: true,
    maxTokens: 1000,
    temperature: 0.7,
    topP: 1.0,
    enableReranking: false,
    rerankingModel: null,
    enableCrossEncoder: false,
    crossEncoderModel: null,
    crossEncoderTopK: 10,
    enableUserLogin: true,
    enableSelfProvision: false,
    enableSelfProvisionAdmin: false,
    enableSelfProvisionAdminCode: false,
    enableMagicLogin: true,
    enablePasswordLogin: false,
    enableSharedPassword: false,
    sharedPassword: null,
    enableGoogleAuth: false,
    googleClientId: null,
    enableFacebookAuth: false,
    facebookAppId: null,
    enableTwitterAuth: false,
    twitterApiKey: null,
    enableLinkedInAuth: false,
    linkedInClientId: null,
    enableGitHubAuth: false,
    gitHubClientId: null,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (isPublicPage as jest.Mock).mockReturnValue(false);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  const TestComponent = () => <div>Protected Content</div>;

  it("shows nothing initially, then loading spinner after 2 seconds", async () => {
    jest.useFakeTimers();

    // Mock fetch to never resolve (simulating slow auth)
    let resolveAuth: (value: any) => void;
    (global.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        })
    );

    render(
      <AuthGuard siteConfig={mockSiteConfig}>
        <TestComponent />
      </AuthGuard>
    );

    // Initially should show nothing (blank)
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();

    // Fast-forward 2 seconds and flush updates
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Now should show loading spinner
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();

    jest.useRealTimers();
  });

  it("renders children for public pages without auth check", async () => {
    (isPublicPage as jest.Mock).mockReturnValue(true);

    render(
      <AuthGuard siteConfig={mockSiteConfig}>
        <TestComponent />
      </AuthGuard>
    );

    await waitFor(() => {
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    // Should not have called fetch for authentication
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders children when site does not require login", async () => {
    const noLoginSiteConfig = { ...mockSiteConfig, requireLogin: false };

    render(
      <AuthGuard siteConfig={noLoginSiteConfig}>
        <TestComponent />
      </AuthGuard>
    );

    await waitFor(() => {
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    // Should not have called fetch for authentication
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders children when authentication succeeds", async () => {
    render(
      <AuthGuard siteConfig={mockSiteConfig}>
        <TestComponent />
      </AuthGuard>
    );

    await waitFor(() => {
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/web-token", {
      headers: {
        Referer: "http://localhost/",
      },
    });
  });

  it("redirects to login when authentication fails with 401", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
    });
    mockRouter.asPath = "/protected-page?param=value";

    render(
      <AuthGuard siteConfig={mockSiteConfig}>
        <TestComponent />
      </AuthGuard>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login?redirect=%2Fprotected-page%3Fparam%3Dvalue");
    });

    // Should not render children during redirect (may or may not show loading)
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("handles network errors gracefully", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    render(
      <AuthGuard siteConfig={mockSiteConfig}>
        <TestComponent />
      </AuthGuard>
    );

    await waitFor(() => {
      // Should not render children on network error
      expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    });
  });

  it("waits for router to be ready before checking auth", () => {
    const mockRouterNotReady = { ...mockRouter, isReady: false };
    (useRouter as jest.Mock).mockReturnValue(mockRouterNotReady);

    render(
      <AuthGuard siteConfig={mockSiteConfig}>
        <TestComponent />
      </AuthGuard>
    );

    // Should show nothing initially when router not ready and not call fetch
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("waits for siteConfig before checking auth", () => {
    render(
      <AuthGuard siteConfig={null}>
        <TestComponent />
      </AuthGuard>
    );

    // Should show nothing initially and not call fetch
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
