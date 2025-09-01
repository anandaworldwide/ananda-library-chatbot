// Admin Users page: Add Users modal and Pending Users list with Resend
import React, { useEffect, useState } from "react";
import Head from "next/head";
import Layout from "@/components/layout";
import { SiteConfig } from "@/types/siteConfig";
import type { GetServerSideProps, NextApiRequest } from "next";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { isAdminPageAllowed } from "@/utils/server/adminPageGate";
import { Breadcrumb } from "@/components/Breadcrumb";
import { AddUsersModal } from "@/components/AddUsersModal";

interface ActiveUser {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  uuid?: string | null;
  role?: string;
  verifiedAt: string | null;
  lastLoginAt: string | null;
  entitlements: Record<string, any>;
}

interface AdminUsersPageProps {
  siteConfig: SiteConfig | null;
  isSudoAdmin: boolean;
}

interface PaginationInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

type SortOption = "name-asc" | "login-desc";

// Helper component for date display (date only, no time)
function DateDisplay({ dateString }: { dateString: string | null }) {
  if (!dateString) return <span>–</span>;

  // dateString is already formatted as locale string from the API
  // Extract just the date part (before the comma and time)
  const dateOnly = dateString.split(",")[0];

  return <span>{dateOnly}</span>;
}

// Helper function to get display name
function getDisplayName(user: ActiveUser): string {
  const firstName = user.firstName?.trim() || "";
  const lastName = user.lastName?.trim() || "";

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  } else if (firstName) {
    return firstName;
  } else if (lastName) {
    return lastName;
  } else {
    return user.email; // Fallback to email if no name
  }
}

// Helper function to truncate email for display
function truncateEmail(email: string, maxLength: number = 15): string {
  if (email.length <= maxLength) {
    return email;
  }
  return email.substring(0, maxLength) + "...";
}

export default function AdminUsersPage({ siteConfig }: AdminUsersPageProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"info" | "error">("info");
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [pendingLoading, setPendingLoading] = useState<boolean>(true);
  const [active, setActive] = useState<ActiveUser[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [jwt, setJwt] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("login-desc");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>("");

  // Shared function to handle token refresh and retry logic
  async function fetchWithTokenRefresh<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<{ data: T; refreshedToken?: string }> {
    const res = await fetch(url, {
      ...options,
      headers: jwt ? { Authorization: `Bearer ${jwt}`, ...options.headers } : options.headers,
    });
    const data = await res.json();

    if (res.status === 401) {
      // Token expired - try to refresh
      const tokenRes = await fetch("/api/web-token");
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        const newToken = tokenData.token;

        // Retry the original request with new token
        const retryRes = await fetch(url, {
          ...options,
          headers: { Authorization: `Bearer ${newToken}`, ...options.headers },
        });
        const retryData = await retryRes.json();

        if (!retryRes.ok) {
          throw new Error(retryData?.error || "Request failed after token refresh");
        }

        return { data: retryData, refreshedToken: newToken };
      } else {
        // Refresh failed - redirect to login
        const fullPath = window.location.pathname + (window.location.search || "");
        window.location.href = `/login?redirect=${encodeURIComponent(fullPath)}`;
        throw new Error("Authentication failed");
      }
    }

    if (!res.ok) {
      throw new Error(data?.error || "Request failed");
    }

    return { data };
  }

  async function fetchPendingCount() {
    try {
      const { data, refreshedToken } = await fetchWithTokenRefresh<{ count: number }>("/api/admin/pendingUsersCount");

      // Update JWT if it was refreshed
      if (refreshedToken) {
        setJwt(refreshedToken);
      }

      setPendingCount(data.count || 0);
      setPendingLoading(false);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load pending users count");
      setMessageType("error");
      setPendingLoading(false);
    }
  }

  async function fetchActive(page: number = 1) {
    setActiveLoading(true);
    setDataLoaded(false);

    // Show loading message only after 3 seconds
    const loadingTimer = setTimeout(() => {
      setShowLoading(true);
    }, 3000);

    try {
      // Build query parameters
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        sortBy: sortBy,
      });

      // Add search parameter if there's a debounced search query
      if (debouncedSearchQuery.trim()) {
        params.append("search", debouncedSearchQuery.trim());
      }

      const { data, refreshedToken } = await fetchWithTokenRefresh<{
        items: any[];
        pagination: PaginationInfo;
      }>(`/api/admin/listActiveUsers?${params.toString()}`);

      // Update JWT if it was refreshed
      if (refreshedToken) {
        setJwt(refreshedToken);
      }

      const items: ActiveUser[] = (data.items || []).map((it: any) => ({
        email: it.email,
        firstName: it.firstName ?? null,
        lastName: it.lastName ?? null,
        uuid: it.uuid ?? null,
        role: it.role || undefined,
        verifiedAt: it.verifiedAt ? new Date(it.verifiedAt).toLocaleString() : null,
        lastLoginAt: it.lastLoginAt ? new Date(it.lastLoginAt).toLocaleString() : null,
        entitlements: it.entitlements || {},
      }));

      setActive(items);
      setPagination(data.pagination);
      setDataLoaded(true);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load active users");
      setMessageType("error");
    } finally {
      clearTimeout(loadingTimer);
      setActiveLoading(false);
      setShowLoading(false);
      // Only set dataLoaded if we didn't have an error
      if (!dataLoaded) {
        setDataLoaded(true);
      }
    }
  }

  // Acquire a short-lived JWT on mount and handle token refresh
  useEffect(() => {
    async function getToken() {
      try {
        const res = await fetch("/api/web-token");
        const data = await res.json();
        if (res.ok && data?.token) {
          setJwt(data.token);
          setMessage(null); // Clear any previous error messages
        } else if (res.status === 401) {
          // Token expired or authentication issue - redirect to login
          const fullPath = window.location.pathname + (window.location.search || "");
          window.location.href = `/login?redirect=${encodeURIComponent(fullPath)}`;
        } else {
          setMessage(data?.error || "Failed to obtain auth token");
          setMessageType("error");
        }
      } catch (e: any) {
        setMessage(e?.message || "Failed to obtain auth token");
        setMessageType("error");
      }
    }
    getToken();
  }, []);

  // Add window focus listener to refresh token when user returns to page
  useEffect(() => {
    async function handleWindowFocus() {
      // Only refresh if we don't have a valid JWT or if it's been a while
      if (!jwt) {
        try {
          const res = await fetch("/api/web-token");
          const data = await res.json();
          if (res.ok && data?.token) {
            setJwt(data.token);
            setMessage(null);
            // Refresh data with new token
            fetchPendingCount();
            fetchActive(currentPage);
          } else if (res.status === 401) {
            const fullPath = window.location.pathname + (window.location.search || "");
            window.location.href = `/login?redirect=${encodeURIComponent(fullPath)}`;
          }
        } catch (e) {
          console.error("Failed to refresh token on focus:", e);
        }
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [jwt, currentPage]);

  // Fetch pending count and active users once JWT is available
  useEffect(() => {
    if (!jwt) return;
    fetchPendingCount();
    fetchActive(currentPage);
    // Intentionally only depends on jwt to refetch if token is refreshed
  }, [jwt]);

  // Debounce search query to prevent excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300); // 300ms debounce delay

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch active users when page, sort, or debounced search changes
  useEffect(() => {
    if (!jwt) return;
    fetchActive(currentPage);
  }, [currentPage, jwt, sortBy, debouncedSearchQuery]);

  // Handle sort change
  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort);
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  // Handle search change with debouncing
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1); // Reset to first page when searching
  };

  async function handleAddUsers(emails: string[], customMessage?: string) {
    setSubmitting(true);
    setMessage(null);
    setMessageType("info");

    try {
      let successCount = 0;
      let resentCount = 0;
      const alreadyActiveEmails: string[] = [];
      const errors: string[] = [];

      // Process emails in parallel batches for better performance
      const BATCH_SIZE = 10; // Process 10 emails simultaneously
      const batches = [];

      // Split emails into batches
      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        batches.push(emails.slice(i, i + BATCH_SIZE));
      }

      // Process each batch in parallel
      for (const batch of batches) {
        const batchPromises = batch.map(async (email) => {
          try {
            const { data, refreshedToken } = await fetchWithTokenRefresh<{ message: string }>("/api/admin/addUser", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              credentials: "include",
              body: JSON.stringify({ email, customMessage }),
            });

            return {
              email,
              success: true,
              message: data?.message,
              refreshedToken,
            };
          } catch (e: any) {
            return {
              email,
              success: false,
              error: e?.message || "Failed to add",
            };
          }
        });

        // Wait for all emails in this batch to complete
        const batchResults = await Promise.all(batchPromises);

        // Process results and update JWT if any token was refreshed
        batchResults.forEach((result) => {
          if (result.success) {
            // Update JWT if it was refreshed (only need to do this once)
            if (result.refreshedToken) {
              setJwt(result.refreshedToken);
            }

            // Interpret backend messages
            if (result.message === "already active") {
              alreadyActiveEmails.push(result.email);
            } else if (result.message === "resent") {
              resentCount++;
            } else if (result.message === "created") {
              successCount++;
            } else {
              successCount++; // Default to success
            }
          } else {
            errors.push(`${result.email}: ${result.error}`);
          }
        });
      }

      // Generate summary message
      const parts: string[] = [];
      if (successCount > 0) {
        parts.push(`${successCount} invitation${successCount === 1 ? "" : "s"} sent`);
      }
      if (resentCount > 0) {
        parts.push(`${resentCount} invitation${resentCount === 1 ? "" : "s"} resent`);
      }
      if (alreadyActiveEmails.length > 0) {
        const emailBullets = alreadyActiveEmails.map((email) => `• ${email}`).join("\n");
        parts.push(
          `${alreadyActiveEmails.length} user${alreadyActiveEmails.length === 1 ? " was" : "s were"} already active:\n${emailBullets}`
        );
      }

      if (parts.length > 0) {
        setMessage(parts.join(". "));
        setMessageType("info");
      }

      if (errors.length > 0) {
        if (parts.length === 0) {
          // All failed
          setMessage(`Failed to add users: ${errors.join("; ")}`);
          setMessageType("error");
        } else {
          // Some succeeded, some failed
          setMessage(`${parts.join(". ")}. Errors: ${errors.join("; ")}`);
          setMessageType("info");
        }
      }

      // Refresh the lists
      setPendingLoading(true);
      await fetchPendingCount();
      await fetchActive(currentPage);
    } catch (e: any) {
      setMessage(e?.message || "Failed to add users");
      setMessageType("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout siteConfig={siteConfig}>
      <Head>
        <title>Admin · Users</title>
      </Head>
      <div className="mx-auto max-w-3xl p-6">
        <Breadcrumb items={[{ label: "Admin Dashboard", href: "/admin" }, { label: "Users" }]} />

        <div className="mb-8">
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={submitting}
            className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Users
          </button>
        </div>

        <AddUsersModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onAddUsers={handleAddUsers}
          isSubmitting={submitting}
        />

        {message && (
          <div
            className={`mb-4 rounded border p-3 text-sm whitespace-pre-line ${
              messageType === "error" ? "border-red-300 bg-red-50 text-red-800" : "border-yellow-300 bg-yellow-50"
            }`}
          >
            {message}
          </div>
        )}

        {/* Pending Users Count */}
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              {pendingLoading ? (
                <h3 className="text-lg font-semibold text-gray-900">
                  <span className="opacity-0">0 pending user invitations</span>
                </h3>
              ) : pendingCount === 0 ? (
                <h3 className="text-lg font-semibold text-gray-900">No pending invitations</h3>
              ) : (
                <h3 className="text-lg font-semibold text-gray-900">
                  <a href="/admin/users/pending" className="text-blue-600 hover:text-blue-800 underline">
                    {pendingCount} pending user invitation{pendingCount === 1 ? "" : "s"}
                  </a>
                </h3>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Active Users</h2>
            <div className="text-sm text-gray-600 min-w-0 flex-shrink-0">
              {pagination && pagination.totalCount > 0 ? (
                <>
                  Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
                  {Math.min(pagination.page * pagination.limit, pagination.totalCount)} of {pagination.totalCount} users
                  {debouncedSearchQuery && <span className="ml-2 text-gray-500">(filtered)</span>}
                </>
              ) : (
                <span className="opacity-0">Showing 1 to 20 of 100 users</span>
              )}
            </div>
          </div>

          {/* Search Box */}
          <div className="mb-4">
            <div className="relative max-w-md">
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearchChange("")}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  <span className="material-icons text-sm">close</span>
                </button>
              )}
            </div>
          </div>

          {/* Always show the table structure */}
          <table className="w-full text-left text-sm table-fixed">
            <colgroup>
              <col className="w-1/4" />
              <col className="w-1/4" />
              <col className="w-16" />
              <col className="w-24" />
              <col className="w-auto" />
            </colgroup>
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-6">
                  <button
                    onClick={() => handleSortChange("name-asc")}
                    className={`flex items-center gap-1 hover:text-blue-600 ${
                      sortBy === "name-asc" ? "text-blue-600 font-semibold" : ""
                    }`}
                  >
                    Name
                    {sortBy === "name-asc" && <span className="text-xs">↑</span>}
                  </button>
                </th>
                <th className="py-2 pr-6">Email</th>
                <th className="py-2 pr-6">Role</th>
                <th className="py-2 pr-6">
                  <button
                    onClick={() => handleSortChange("login-desc")}
                    className={`flex items-center gap-1 hover:text-blue-600 ${
                      sortBy === "login-desc" ? "text-blue-600 font-semibold" : ""
                    }`}
                  >
                    Last Login
                    {sortBy === "login-desc" && <span className="text-xs">↓</span>}
                  </button>
                </th>
                <th className="py-2">Entitlements</th>
              </tr>
            </thead>
            <tbody>
              {activeLoading ? (
                // Show loading state in the table body
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-gray-600">
                    {showLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                        <span>Loading users...</span>
                      </div>
                    ) : (
                      // Empty state - just show the headers, no message
                      <div className="py-4"></div>
                    )}
                  </td>
                </tr>
              ) : dataLoaded && active.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-gray-600">
                    {debouncedSearchQuery ? `No users found matching "${debouncedSearchQuery}"` : "No active users"}
                  </td>
                </tr>
              ) : dataLoaded && active.length > 0 ? (
                active.map((u) => (
                  <tr key={u.email} className="border-b">
                    <td className="py-2 pr-6">
                      <a
                        className="text-blue-600 underline hover:text-blue-800"
                        href={`/admin/users/${encodeURIComponent(u.email)}`}
                      >
                        {getDisplayName(u)}
                      </a>
                    </td>
                    <td className="py-2 pr-6">
                      <span title={u.email} className="cursor-help">
                        {truncateEmail(u.email)}
                      </span>
                    </td>
                    <td className="py-2 pr-6">{u.role || "–"}</td>
                    <td className="py-2 pr-6">
                      <DateDisplay dateString={u.lastLoginAt} />
                    </td>
                    <td className="py-2">
                      {Object.keys(u.entitlements).length > 0
                        ? Object.keys(u.entitlements)
                            .filter((key) => u.entitlements[key])
                            .join(", ")
                        : "–"}
                    </td>
                  </tr>
                ))
              ) : (
                // Data not loaded yet - show empty table body
                <tr>
                  <td colSpan={5} className="py-4"></td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination Controls - only show when not loading and have data */}
          {!activeLoading && pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-6">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={!pagination.hasPrev}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={!pagination.hasPrev}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Previous
              </button>

              <span className="px-3 py-1 text-sm">
                Page {pagination.page} of {pagination.totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={!pagination.hasNext}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next
              </button>
              <button
                onClick={() => setCurrentPage(pagination.totalPages)}
                disabled={!pagination.hasNext}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Last
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<AdminUsersPageProps> = async ({ req }) => {
  const siteConfig = await loadSiteConfig();
  const allowed = await isAdminPageAllowed(req as NextApiRequest, undefined as any, siteConfig);
  if (!allowed) return { notFound: true };
  return { props: { siteConfig, isSudoAdmin: true } };
};
