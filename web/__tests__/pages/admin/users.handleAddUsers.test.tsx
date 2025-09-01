import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import AdminUsersPage from "@/pages/admin/users";
import { SudoProvider } from "@/contexts/SudoContext";

import { configure } from "@testing-library/react";

// Reduce verbose DOM dumps on query failures
configure({ getElementError: (message) => new Error(message || "") });

// Mock Next.js router
jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    pathname: "/admin/users",
  }),
}));

// Mock the site config
const mockSiteConfig = {
  siteId: "test",
  shortname: "test",
  name: "Test Site",
  tagline: "Test tagline",
  greeting: "Test greeting",
  parent_site_url: "https://test.com",
  parent_site_name: "Test Parent",
  help_url: "https://test.com/help",
  help_text: "Help text",
  collectionConfig: {},
  libraryMappings: {},
  enableSuggestedQueries: false,
  enableMediaTypeSelection: false,
  enableAuthorSelection: false,
  welcome_popup_heading: "Welcome",
  other_visitors_reference: "other visitors",
  loginImage: null,
  header: { logo: "test.png", navItems: [] },
  footer: { links: [] },
  requireLogin: true,
  allowTemporarySessions: false,
  allowAllAnswersPage: false,
  npsSurveyFrequencyDays: 30,
  queriesPerUserPerDay: 100,
  showSourceContent: true,
  showVoting: true,
};

// Mock fetch for API calls
global.fetch = jest.fn();

describe("AdminUsersPage - handleAddUsers functionality", () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  const setupInitialMocks = () => {
    (fetch as jest.Mock).mockImplementation((url) => {
      if (url === "/api/web-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "mock-jwt" }),
        });
      } else if (url === "/api/profile") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ firstName: "TestAdmin" }),
        });
      } else if (url === "/api/admin/pendingUsersCount") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count: 0 }),
        });
      } else if (url.startsWith("/api/admin/listActiveUsers")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [],
              pagination: {
                page: 1,
                limit: 20,
                totalCount: 0,
                totalPages: 0,
                hasNext: false,
                hasPrev: false,
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
  };

  it("displays bullet-point formatted message for already active users", async () => {
    setupInitialMocks();

    // Mock the addUser API calls to simulate mixed results
    const originalFetch = (fetch as jest.Mock).getMockImplementation();

    (fetch as jest.Mock).mockImplementation((url, options) => {
      // Handle initial page load calls and profile API
      if (!options || options.method !== "POST") {
        if (url === "/api/profile") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ firstName: "TestAdmin" }),
          });
        }
        return originalFetch?.(url, options);
      }

      // Handle addUser POST requests
      if (url === "/api/admin/addUser" && options.method === "POST") {
        const body = JSON.parse(options.body);

        if (body.email === "new1@test.com") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ message: "created" }),
          });
        } else if (body.email === "existing1@test.com") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ message: "already active" }),
          });
        } else if (body.email === "existing2@test.com") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ message: "already active" }),
          });
        } else if (body.email === "pending@test.com") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ message: "resent" }),
          });
        }
      }

      return originalFetch?.(url, options);
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    // Wait for page to load
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add users/i })).toBeInTheDocument();
    });

    // Open the add users modal
    const addUsersButton = screen.getByRole("button", { name: /add users/i });
    fireEvent.click(addUsersButton);

    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByLabelText("Email Addresses")).toBeInTheDocument();
    });

    // Enter mixed email addresses
    const emailTextarea = screen.getByLabelText("Email Addresses");
    fireEvent.change(emailTextarea, {
      target: { value: "new1@test.com, existing1@test.com, existing2@test.com, pending@test.com" },
    });

    // Submit the form
    const submitButton = screen.getByRole("button", { name: /add 4 users/i });
    fireEvent.click(submitButton);

    // Wait for the success message with bullet points
    await waitFor(() => {
      const matches = screen.getAllByText((content, element) => {
        const text = element?.textContent || "";
        return (
          text.includes("1 invitation sent") &&
          text.includes("1 invitation resent") &&
          text.includes("2 users were already active:")
        );
      });
      expect(matches.length).toBeGreaterThan(0);
    });

    // Check that the message contains bullet-formatted emails
    const messageElements = screen.getAllByText((content, element) => {
      const text = element?.textContent || "";
      return text.includes("• existing1@test.com") && text.includes("• existing2@test.com");
    });
    expect(messageElements.length).toBeGreaterThan(0);
  });

  it("handles single already active user with proper formatting", async () => {
    setupInitialMocks();

    const originalFetch = (fetch as jest.Mock).getMockImplementation();

    (fetch as jest.Mock).mockImplementation((url, options) => {
      if (!options || options.method !== "POST") {
        if (url === "/api/profile") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ firstName: "TestAdmin" }),
          });
        }
        return originalFetch?.(url, options);
      }

      if (url === "/api/admin/addUser" && options.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: "already active" }),
        });
      }

      return originalFetch?.(url, options);
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add users/i })).toBeInTheDocument();
    });

    const addUsersButton = screen.getByRole("button", { name: /add users/i });
    fireEvent.click(addUsersButton);

    await waitFor(() => {
      expect(screen.getByLabelText("Email Addresses")).toBeInTheDocument();
    });

    const emailTextarea = screen.getByLabelText("Email Addresses");
    fireEvent.change(emailTextarea, {
      target: { value: "existing@test.com" },
    });

    const submitButton = screen.getByRole("button", { name: /add 1 user/i });
    fireEvent.click(submitButton);

    // Wait for the success message with singular formatting
    await waitFor(() => {
      const messageElements = screen.getAllByText((content, element) => {
        const text = element?.textContent || "";
        return text.includes("1 user was already active:");
      });
      expect(messageElements.length).toBeGreaterThan(0);
    });

    // Check that the message contains bullet-formatted email
    const messageElements = screen.getAllByText((content, element) => {
      const text = element?.textContent || "";
      return text.includes("• existing@test.com");
    });
    expect(messageElements.length).toBeGreaterThan(0);
  });

  it("handles all successful invitations without already active users", async () => {
    setupInitialMocks();

    const originalFetch = (fetch as jest.Mock).getMockImplementation();

    (fetch as jest.Mock).mockImplementation((url, options) => {
      if (!options || options.method !== "POST") {
        if (url === "/api/profile") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ firstName: "TestAdmin" }),
          });
        }
        return originalFetch?.(url, options);
      }

      if (url === "/api/admin/addUser" && options.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: "created" }),
        });
      }

      return originalFetch?.(url, options);
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add users/i })).toBeInTheDocument();
    });

    const addUsersButton = screen.getByRole("button", { name: /add users/i });
    fireEvent.click(addUsersButton);

    await waitFor(() => {
      expect(screen.getByLabelText("Email Addresses")).toBeInTheDocument();
    });

    const emailTextarea = screen.getByLabelText("Email Addresses");
    fireEvent.change(emailTextarea, {
      target: { value: "new1@test.com, new2@test.com" },
    });

    const submitButton = screen.getByRole("button", { name: /add 2 users/i });
    fireEvent.click(submitButton);

    // Wait for the success message without already active users
    await waitFor(() => {
      const messageElement = screen.getByText("2 invitations sent");
      expect(messageElement).toBeInTheDocument();
    });

    // Ensure no "already active" text appears
    expect(screen.queryByText(/already active/)).not.toBeInTheDocument();
  });

  it("handles errors with already active users in mixed results", async () => {
    setupInitialMocks();

    const originalFetch = (fetch as jest.Mock).getMockImplementation();

    (fetch as jest.Mock).mockImplementation((url, options) => {
      if (!options || options.method !== "POST") {
        if (url === "/api/profile") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ firstName: "TestAdmin" }),
          });
        }
        return originalFetch?.(url, options);
      }

      if (url === "/api/admin/addUser" && options.method === "POST") {
        const body = JSON.parse(options.body);

        if (body.email === "success@test.com") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ message: "created" }),
          });
        } else if (body.email === "existing@test.com") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ message: "already active" }),
          });
        } else if (body.email === "error@test.com") {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "Invalid email format" }),
          });
        }
      }

      return originalFetch?.(url, options);
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add users/i })).toBeInTheDocument();
    });

    const addUsersButton = screen.getByRole("button", { name: /add users/i });
    fireEvent.click(addUsersButton);

    await waitFor(() => {
      expect(screen.getByLabelText("Email Addresses")).toBeInTheDocument();
    });

    const emailTextarea = screen.getByLabelText("Email Addresses");
    fireEvent.change(emailTextarea, {
      target: { value: "success@test.com, existing@test.com, error@test.com" },
    });

    const submitButton = screen.getByRole("button", { name: /add 3 users/i });
    fireEvent.click(submitButton);

    // Wait for the mixed results message
    const mixedMessages = await screen.findAllByText(
      (content, element) => {
        const text = element?.textContent || "";
        return (
          text.includes("1 invitation sent") &&
          text.includes("1 user was already active:") &&
          text.includes("• existing@test.com") &&
          text.includes("Errors: error@test.com: Invalid email format")
        );
      },
      undefined,
      { timeout: 3000 }
    );
    expect(mixedMessages.length).toBeGreaterThan(0);
  });

  it("passes custom message to addUser API", async () => {
    setupInitialMocks();

    const originalFetch = (fetch as jest.Mock).getMockImplementation();
    let capturedCustomMessage = "";

    (fetch as jest.Mock).mockImplementation((url, options) => {
      if (!options || options.method !== "POST") {
        if (url === "/api/profile") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ firstName: "TestAdmin" }),
          });
        }
        return originalFetch?.(url, options);
      }

      if (url === "/api/admin/addUser" && options.method === "POST") {
        const body = JSON.parse(options.body);
        capturedCustomMessage = body.customMessage || "";

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: "created" }),
        });
      }

      return originalFetch?.(url, options);
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add users/i })).toBeInTheDocument();
    });

    const addUsersButton = screen.getByRole("button", { name: /add users/i });
    fireEvent.click(addUsersButton);

    await waitFor(() => {
      expect(screen.getByLabelText("Email Addresses")).toBeInTheDocument();
    });

    // Enter email and custom message
    const emailTextarea = screen.getByLabelText("Email Addresses");
    fireEvent.change(emailTextarea, {
      target: { value: "test@example.com" },
    });

    const customMessageTextarea = screen.getByLabelText("Custom Message (Optional)");
    fireEvent.change(customMessageTextarea, {
      target: { value: "Welcome to our spiritual community!" },
    });

    const submitButton = screen.getByRole("button", { name: /add 1 user/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("1 invitation sent")).toBeInTheDocument();
    });

    // Verify the custom message was passed to the API
    expect(capturedCustomMessage).toBe("Welcome to our spiritual community!");
  });
});
