import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import AdminUsersPage from "@/pages/admin/users";
import { SudoProvider } from "@/contexts/SudoContext";

// Mock Next.js router
jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    pathname: "/admin/users",
  }),
}));

// Mock fetchWithAuth from tokenManager
jest.mock("@/utils/client/tokenManager", () => ({
  fetchWithAuth: jest.fn(),
  isAuthenticated: jest.fn().mockReturnValue(true), // Mock as authenticated by default
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

describe("AdminUsersPage", () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  it("sorts active users by last login descending", async () => {
    // Mock the API responses in the correct sequence:
    // 1. /api/web-token for JWT
    // 2. /api/admin/listPendingUsers for pending users count
    // 3. /api/admin/listActiveUsers for active users table
    (fetch as jest.Mock).mockImplementation((url) => {
      if (url === "/api/web-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "mock-jwt" }),
        });
      } else if (url === "/api/admin/listPendingUsers") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }), // No pending users for count
        });
      } else if (url.startsWith("/api/admin/listActiveUsers")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  email: "recent-user@test.com",
                  firstName: "Recent",
                  lastName: "User",
                  lastLoginAt: "2024-01-01T12:00:00.000Z", // More recent login
                  role: "admin",
                  entitlements: {},
                },
                {
                  email: "old-user@test.com",
                  firstName: "Old",
                  lastName: "User",
                  lastLoginAt: "2023-01-01T12:00:00.000Z", // Older login
                  role: "user",
                  entitlements: {},
                },
                {
                  email: "never-logged-in@test.com",
                  firstName: "Never",
                  lastName: "LoggedIn",
                  lastLoginAt: null, // No login
                  role: "user",
                  entitlements: {},
                },
              ],
              pagination: {
                page: 1,
                limit: 20,
                totalCount: 3,
                totalPages: 1,
                hasNext: false,
                hasPrev: false,
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    // Wait for the data to load
    await waitFor(() => {
      expect(screen.getByText("Recent User")).toBeInTheDocument();
    });

    // Get user name links specifically from the active users table
    // These are the only links that point to user detail pages
    const userLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/admin/users/"));
    const userNames = userLinks.map((link) => link.textContent);

    // Verify the order: Backend now handles sorting, so the order should match the API response
    // Recent User (most recent login) should be first, Old User (older login) second, Never LoggedIn (no login) last
    expect(userNames).toEqual(["Recent User", "Old User", "Never LoggedIn"]);
  });

  it("handles users with no login data correctly", async () => {
    // Mock the API responses with users that have no login data
    (fetch as jest.Mock).mockImplementation((url) => {
      if (url === "/api/web-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "mock-jwt" }),
        });
      } else if (url === "/api/admin/listPendingUsers") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }), // No pending users for count
        });
      } else if (url.startsWith("/api/admin/listActiveUsers")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  email: "user1@test.com",
                  firstName: "User",
                  lastName: "One",
                  lastLoginAt: null,
                  role: "user",
                  entitlements: {},
                },
                {
                  email: "user2@test.com",
                  firstName: "User",
                  lastName: "Two",
                  lastLoginAt: null,
                  role: "user",
                  entitlements: {},
                },
              ],
              pagination: {
                page: 1,
                limit: 20,
                totalCount: 2,
                totalPages: 1,
                hasNext: false,
                hasPrev: false,
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    // Wait for the data to load
    await waitFor(() => {
      expect(screen.getByText("User One")).toBeInTheDocument();
    });

    // Should render both users without crashing
    expect(screen.getByText("User One")).toBeInTheDocument();
    expect(screen.getByText("User Two")).toBeInTheDocument();
  });

  it("opens add users modal when button is clicked", async () => {
    // Mock the API responses
    (fetch as jest.Mock).mockImplementation((url) => {
      if (url === "/api/web-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "mock-jwt" }),
        });
      } else if (url === "/api/admin/listPendingUsers") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
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

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    // Wait for the page to load
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add users/i })).toBeInTheDocument();
    });

    // Initially, modal should not be visible
    expect(screen.queryByLabelText("Email Addresses")).not.toBeInTheDocument();

    // Click the Add Users button
    const addUsersButton = screen.getByRole("button", { name: /add users/i });
    fireEvent.click(addUsersButton);

    // Modal should appear
    expect(screen.getByLabelText("Email Addresses")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("allows sorting by name ascending and last login descending", async () => {
    const mockUsersLoginDesc = [
      {
        email: "alice@test.com",
        firstName: "Alice",
        lastName: "Smith",
        role: "admin",
        lastLoginAt: "2024-01-20T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
      {
        email: "charlie@test.com",
        firstName: "Charlie",
        lastName: "Brown",
        role: "user",
        lastLoginAt: "2024-01-15T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
      {
        email: "bob@test.com",
        firstName: "Bob",
        lastName: "Johnson",
        role: "user",
        lastLoginAt: "2024-01-10T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
    ];

    const mockUsersNameAsc = [
      {
        email: "alice@test.com",
        firstName: "Alice",
        lastName: "Smith",
        role: "admin",
        lastLoginAt: "2024-01-20T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
      {
        email: "bob@test.com",
        firstName: "Bob",
        lastName: "Johnson",
        role: "user",
        lastLoginAt: "2024-01-10T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
      {
        email: "charlie@test.com",
        firstName: "Charlie",
        lastName: "Brown",
        role: "user",
        lastLoginAt: "2024-01-15T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
    ];

    // Mock the API responses to return different data based on sortBy parameter
    (fetch as jest.Mock).mockImplementation((url) => {
      if (url === "/api/web-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "mock-jwt" }),
        });
      } else if (url === "/api/admin/listPendingUsers") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        });
      } else if (url.startsWith("/api/admin/listActiveUsers")) {
        // Check if the URL contains sortBy=name-asc
        const isNameSort = url.includes("sortBy=name-asc");
        const users = isNameSort ? mockUsersNameAsc : mockUsersLoginDesc;

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: users,
              pagination: {
                page: 1,
                limit: 20,
                totalCount: 3,
                totalPages: 1,
                hasNext: false,
                hasPrev: false,
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    // Wait for users to load (default sort is last login descending)
    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    // Check default sort order (last login descending: Alice, Charlie, Bob)
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Alice Smith"); // Most recent login
    expect(rows[2]).toHaveTextContent("Charlie Brown");
    expect(rows[3]).toHaveTextContent("Bob Johnson"); // Oldest login

    // Click on Name header to sort by name ascending
    const nameHeader = screen.getByRole("button", { name: /name/i });
    fireEvent.click(nameHeader);

    // Wait for API call and re-render with name-sorted data (Alice, Bob, Charlie)
    await waitFor(() => {
      const sortedRows = screen.getAllByRole("row");
      expect(sortedRows[1]).toHaveTextContent("Alice Smith");
      expect(sortedRows[2]).toHaveTextContent("Bob Johnson");
      expect(sortedRows[3]).toHaveTextContent("Charlie Brown");
    });

    // Verify the name header shows active sort indicator
    expect(nameHeader).toHaveClass("text-blue-600", "font-semibold");
    expect(nameHeader).toHaveTextContent("↑");

    // Click on Last Login header to sort by last login descending
    const loginHeader = screen.getByRole("button", { name: /last login/i });
    fireEvent.click(loginHeader);

    // Wait for API call and re-render with login-sorted data (Alice, Charlie, Bob)
    await waitFor(() => {
      const sortedRows = screen.getAllByRole("row");
      expect(sortedRows[1]).toHaveTextContent("Alice Smith"); // Most recent
      expect(sortedRows[2]).toHaveTextContent("Charlie Brown");
      expect(sortedRows[3]).toHaveTextContent("Bob Johnson"); // Oldest
    });

    // Verify the last login header shows active sort indicator
    expect(loginHeader).toHaveClass("text-blue-600", "font-semibold");
    expect(loginHeader).toHaveTextContent("↓");
  });

  it("allows searching users by name and email", async () => {
    const mockUsers = [
      {
        email: "alice.smith@test.com",
        firstName: "Alice",
        lastName: "Smith",
        role: "admin",
        lastLoginAt: "2024-01-20T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
      {
        email: "bob.jones@example.com",
        firstName: "Bob",
        lastName: "Jones",
        role: "user",
        lastLoginAt: "2024-01-15T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
    ];

    const mockSearchResults = [
      {
        email: "alice.smith@test.com",
        firstName: "Alice",
        lastName: "Smith",
        role: "admin",
        lastLoginAt: "2024-01-20T10:00:00Z",
        verifiedAt: "2024-01-01T10:00:00Z",
        entitlements: {},
      },
    ];

    // Mock the API responses to return different data based on search parameter
    (fetch as jest.Mock).mockImplementation((url) => {
      if (url === "/api/web-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "mock-jwt" }),
        });
      } else if (url === "/api/admin/listPendingUsers") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        });
      } else if (url.startsWith("/api/admin/listActiveUsers")) {
        // Check if the URL contains a search parameter
        const hasSearch = url.includes("search=alice");
        const users = hasSearch ? mockSearchResults : mockUsers;

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: users,
              pagination: {
                page: 1,
                limit: 20,
                totalCount: users.length,
                totalPages: 1,
                hasNext: false,
                hasPrev: false,
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(
      <SudoProvider>
        <AdminUsersPage siteConfig={mockSiteConfig} isSudoAdmin={true} />
      </SudoProvider>
    );

    // Wait for users to load
    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    });

    // Find the search input
    const searchInput = screen.getByPlaceholderText("Search by name or email...");
    expect(searchInput).toBeInTheDocument();

    // Type in search query
    fireEvent.change(searchInput, { target: { value: "alice" } });

    // Wait for debounced search and API call (300ms debounce + API response time)
    await waitFor(
      () => {
        expect(screen.getByText("Alice Smith")).toBeInTheDocument();
        expect(screen.queryByText("Bob Jones")).not.toBeInTheDocument();
      },
      { timeout: 1000 }
    );

    // Clear search
    const clearButton = screen.getByLabelText("Clear search");
    fireEvent.click(clearButton);

    // Wait for search to clear and show all users again
    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    });
  });
});
