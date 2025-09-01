// Admin Pending Users page: Detailed list of pending user invitations
import React, { useEffect, useState } from "react";
import Head from "next/head";
import Layout from "@/components/layout";
import { SiteConfig } from "@/types/siteConfig";
import type { GetServerSideProps, NextApiRequest } from "next";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { isAdminPageAllowed } from "@/utils/server/adminPageGate";
import { Breadcrumb } from "@/components/Breadcrumb";
import { ResendInvitationModal } from "@/components/ResendInvitationModal";

interface PendingUser {
  email: string;
  invitedAt: string | null;
  expiresAt: string | null;
}

interface AdminPendingUsersPageProps {
  siteConfig: SiteConfig | null;
}

interface PaginationInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export default function AdminPendingUsersPage({ siteConfig }: AdminPendingUsersPageProps) {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [jwt, setJwt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"info" | "error">("info");
  const [isResendModalOpen, setIsResendModalOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string>("");
  const [resending, setResending] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);

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

  async function fetchPending(page: number = 1) {
    setLoading(true);
    try {
      // Build query parameters
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });

      const { data, refreshedToken } = await fetchWithTokenRefresh<{
        items: any[];
        pagination: PaginationInfo;
      }>(`/api/admin/listPendingUsers?${params.toString()}`);

      // Update JWT if it was refreshed
      if (refreshedToken) {
        setJwt(refreshedToken);
      }

      const items: PendingUser[] = (data.items || []).map((it: any) => ({
        email: it.email,
        invitedAt: it.invitedAt || null,
        expiresAt: it.expiresAt || null,
      }));
      setPending(items);
      setPagination(data.pagination);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load pending users");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  function handleResendClick(targetEmail: string) {
    setSelectedEmail(targetEmail);
    setIsResendModalOpen(true);
  }

  async function onResend(targetEmail: string, customMessage?: string) {
    setResending(true);
    setMessage(null);
    setMessageType("info");
    try {
      const res = await fetch("/api/admin/resendActivation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ email: targetEmail, customMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to resend");
      setMessage(`Resent invitation to ${targetEmail}`);
      setMessageType("info");
      await fetchPending(currentPage);
    } catch (e: any) {
      setMessage(e?.message || "Failed to resend");
      setMessageType("error");
    } finally {
      setResending(false);
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
      // Only refresh if we don't have a valid JWT
      if (!jwt) {
        try {
          const res = await fetch("/api/web-token");
          const data = await res.json();
          if (res.ok && data?.token) {
            setJwt(data.token);
            setMessage(null);
            // Refresh data with new token
            fetchPending(currentPage);
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

  // Fetch pending users once JWT is available
  useEffect(() => {
    if (!jwt) return;
    fetchPending(currentPage);
  }, [jwt]);

  // Fetch pending users when page changes
  useEffect(() => {
    if (!jwt) return;
    fetchPending(currentPage);
  }, [currentPage, jwt]);

  return (
    <Layout siteConfig={siteConfig}>
      <Head>
        <title>Admin · Pending Users</title>
      </Head>
      <div className="mx-auto max-w-4xl p-6">
        <Breadcrumb
          items={[
            { label: "Admin Dashboard", href: "/admin" },
            { label: "Users", href: "/admin/users" },
            { label: "Pending Invitations" },
          ]}
        />

        <div className="mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Pending User Invitations</h1>
              <p className="text-gray-600 mt-2">
                Manage users who have been invited but haven't completed their activation yet.
              </p>
            </div>
            <div className="text-sm text-gray-600 min-w-0 flex-shrink-0">
              {pagination && pagination.totalCount > 0 ? (
                <>
                  Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
                  {Math.min(pagination.page * pagination.limit, pagination.totalCount)} of {pagination.totalCount}{" "}
                  pending invitations
                </>
              ) : (
                <span className="opacity-0">Showing 1 to 20 of 100 invitations</span>
              )}
            </div>
          </div>
        </div>

        {message && (
          <div
            className={`mb-4 rounded border p-3 text-sm ${
              messageType === "error" ? "border-red-300 bg-red-50 text-red-800" : "border-yellow-300 bg-yellow-50"
            }`}
          >
            {message}
          </div>
        )}

        <div>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="text-gray-600">Loading pending users...</div>
            </div>
          ) : pending.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-500 text-lg mb-2">No pending invitations</div>
              <p className="text-gray-400 text-sm">All users have completed their activation.</p>
            </div>
          ) : (
            <div className="bg-white shadow-sm rounded-lg overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr className="border-b">
                    <th className="py-3 px-4 font-medium text-gray-900">Email</th>
                    <th className="py-3 px-4 font-medium text-gray-900">Invited</th>
                    <th className="py-3 px-4 font-medium text-gray-900">Expires</th>
                    <th className="py-3 px-4 font-medium text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pending.map((u) => (
                    <tr key={u.email} className="hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-900">{u.email}</td>
                      <td className="py-3 px-4 text-gray-600">{u.invitedAt || "–"}</td>
                      <td className="py-3 px-4 text-gray-600">{u.expiresAt || "–"}</td>
                      <td className="py-3 px-4">
                        <button
                          className="inline-flex items-center px-3 py-1 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
                          onClick={() => handleResendClick(u.email)}
                        >
                          Resend
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination Controls - only show when not loading and have data */}
        {!loading && pagination && pagination.totalPages > 1 && (
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

        <div className="mt-6">
          <a
            href="/admin/users"
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 bg-white rounded-md hover:bg-gray-50 transition-colors"
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Users
          </a>
        </div>

        <ResendInvitationModal
          isOpen={isResendModalOpen}
          onClose={() => setIsResendModalOpen(false)}
          onResend={onResend}
          email={selectedEmail}
          isSubmitting={resending}
        />
      </div>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<AdminPendingUsersPageProps> = async ({ req }) => {
  const siteConfig = await loadSiteConfig();
  const allowed = await isAdminPageAllowed(req as NextApiRequest, undefined as any, siteConfig);
  if (!allowed) return { notFound: true };
  return { props: { siteConfig } };
};
