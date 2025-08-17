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
  allowPrivateSessions: false,
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
    // 2. /api/admin/listPendingUsers for pending users table
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
          json: () => Promise.resolve({ items: [] }), // No pending users
        });
      } else if (url === "/api/admin/listActiveUsers") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
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
                {
                  email: "recent-user@test.com",
                  firstName: "Recent",
                  lastName: "User",
                  lastLoginAt: "2024-01-01T12:00:00.000Z", // More recent login
                  role: "admin",
                  entitlements: {},
                },
              ],
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

    // Verify the order: Recent User (most recent login) should be first,
    // Old User (older login) second, Never LoggedIn (no login) last
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
          json: () => Promise.resolve({ items: [] }), // No pending users
        });
      } else if (url === "/api/admin/listActiveUsers") {
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
      } else if (url === "/api/admin/listActiveUsers") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
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
});
