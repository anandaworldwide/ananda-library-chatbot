import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SuggestedQueries from "@/components/SuggestedQueries";
import { SiteConfig } from "@/types/siteConfig";

// Mock dependencies
jest.mock("@/utils/client/analytics", () => ({
  logEvent: jest.fn(),
}));

jest.mock("@/utils/client/tokenManager", () => ({
  fetchWithAuth: jest.fn(),
}));

jest.mock("@/utils/client/uuid", () => ({
  getOrCreateUUID: jest.fn().mockReturnValue("test-uuid"),
}));

import { fetchWithAuth } from "@/utils/client/tokenManager";

describe("SuggestedQueries", () => {
  const mockSiteConfig: SiteConfig = {
    siteId: "test",
    name: "Test Site",
    shortname: "Test",
    tagline: "Test Tagline",
    greeting: "Test Greeting",
    parent_site_url: "",
    parent_site_name: "",
    help_url: "",
    help_text: "",
    collectionConfig: {},
    libraryMappings: {},
    enableSuggestedQueries: true,
    enableMediaTypeSelection: true,
    enableAuthorSelection: true,
    welcome_popup_heading: "",
    other_visitors_reference: "",
    loginImage: null,
    header: { logo: "", navItems: [] },
    footer: { links: [] },
    requireLogin: true,
    allowTemporarySessions: true,
    allowAllAnswersPage: false,
    npsSurveyFrequencyDays: 30,
    queriesPerUserPerDay: 100,
    showSourceContent: true,
    showVoting: true,
  };

  const defaultProps = {
    queries: ["How can I meditate?", "What is yoga?", "Tell me about spirituality"],
    onQueryClick: jest.fn(),
    isLoading: false,
    shuffleQueries: jest.fn(),
    isMobile: false,
    siteConfig: mockSiteConfig,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock successful API response for AI suggestions
    (fetchWithAuth as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          hasEnoughHistory: true,
          suggestions: [
            "How can I improve my meditation?",
            "What is the purpose of life?",
            "How do I find inner peace?",
          ],
        }),
    });
  });

  it("renders AI suggested prompts when user has enough history", async () => {
    render(<SuggestedQueries {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("AI Suggested Prompts")).toBeInTheDocument();
    });
  });

  it("allows editing AI suggested prompts", async () => {
    render(<SuggestedQueries {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("AI Suggested Prompts")).toBeInTheDocument();
    });

    // Click edit button for first suggestion
    const editButtons = screen.getAllByTitle("Edit this question");
    fireEvent.click(editButtons[0]);

    // Check that textarea appears
    expect(screen.getByPlaceholderText("Edit your question...")).toBeInTheDocument();
  });

  it("submits edited query when Enter key is pressed", async () => {
    render(<SuggestedQueries {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("AI Suggested Prompts")).toBeInTheDocument();
    });

    // Click edit button for first suggestion
    const editButtons = screen.getAllByTitle("Edit this question");
    fireEvent.click(editButtons[0]);

    // Get the textarea and modify the text
    const textarea = screen.getByPlaceholderText("Edit your question...");
    fireEvent.change(textarea, { target: { value: "Modified question about meditation" } });

    // Press Enter key
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    // Verify that onQueryClick was called with the edited text
    expect(defaultProps.onQueryClick).toHaveBeenCalledWith("Modified question about meditation");
  });

  it("does not submit edited query when Shift+Enter is pressed", async () => {
    render(<SuggestedQueries {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("AI Suggested Prompts")).toBeInTheDocument();
    });

    // Click edit button for first suggestion
    const editButtons = screen.getAllByTitle("Edit this question");
    fireEvent.click(editButtons[0]);

    // Get the textarea and modify the text
    const textarea = screen.getByPlaceholderText("Edit your question...");
    fireEvent.change(textarea, { target: { value: "Modified question about meditation" } });

    // Press Shift+Enter key
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: true });

    // Verify that onQueryClick was NOT called
    expect(defaultProps.onQueryClick).not.toHaveBeenCalled();
  });

  it("submits edited query when Submit button is clicked", async () => {
    render(<SuggestedQueries {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("AI Suggested Prompts")).toBeInTheDocument();
    });

    // Click edit button for first suggestion
    const editButtons = screen.getAllByTitle("Edit this question");
    fireEvent.click(editButtons[0]);

    // Get the textarea and modify the text
    const textarea = screen.getByPlaceholderText("Edit your question...");
    fireEvent.change(textarea, { target: { value: "Modified question about meditation" } });

    // Click Submit button
    const submitButton = screen.getByText("Submit");
    fireEvent.click(submitButton);

    // Verify that onQueryClick was called with the edited text
    expect(defaultProps.onQueryClick).toHaveBeenCalledWith("Modified question about meditation");
  });

  it("cancels editing when Cancel button is clicked", async () => {
    render(<SuggestedQueries {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("AI Suggested Prompts")).toBeInTheDocument();
    });

    // Click edit button for first suggestion
    const editButtons = screen.getAllByTitle("Edit this question");
    fireEvent.click(editButtons[0]);

    // Verify textarea is visible
    expect(screen.getByPlaceholderText("Edit your question...")).toBeInTheDocument();

    // Click Cancel button
    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);

    // Verify that textarea is no longer visible
    expect(screen.queryByPlaceholderText("Edit your question...")).not.toBeInTheDocument();
    expect(defaultProps.onQueryClick).not.toHaveBeenCalled();
  });

  it("shows random queries when user doesn't have enough history", async () => {
    // Mock API response for insufficient history
    (fetchWithAuth as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          hasEnoughHistory: false,
          suggestions: [],
        }),
    });

    render(<SuggestedQueries {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Suggested Query:")).toBeInTheDocument();
    });

    // Verify random queries are displayed
    expect(screen.getByText("How can I meditate?")).toBeInTheDocument();
  });

  it("shows random queries for sites that don't require login", async () => {
    const noLoginSiteConfig = { ...mockSiteConfig, requireLogin: false };
    const props = { ...defaultProps, siteConfig: noLoginSiteConfig };

    render(<SuggestedQueries {...props} />);

    await waitFor(() => {
      expect(screen.getByText("Suggested Query:")).toBeInTheDocument();
    });

    // Verify random queries are displayed
    expect(screen.getByText("How can I meditate?")).toBeInTheDocument();
  });
});
