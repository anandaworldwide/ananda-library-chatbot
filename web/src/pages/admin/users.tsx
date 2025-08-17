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

interface PendingUser {
  email: string;
  invitedAt: string | null;
  expiresAt: string | null;
}

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

export default function AdminUsersPage({ siteConfig }: AdminUsersPageProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"info" | "error">("info");
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [active, setActive] = useState<ActiveUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [jwt, setJwt] = useState<string | null>(null);

  async function fetchPending() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/listPendingUsers", {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      const items: PendingUser[] = (data.items || []).map((it: any) => ({
        email: it.email,
        invitedAt: it.invitedAt ? new Date(it.invitedAt).toLocaleString() : null,
        expiresAt: it.expiresAt ? new Date(it.expiresAt).toLocaleString() : null,
      }));
      setPending(items);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load pending users");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchActive() {
    try {
      const res = await fetch("/api/admin/listActiveUsers", {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load active users");
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

      // Sort users by last login descending (most recent first)
      items.sort((a, b) => {
        // Handle null values - users with no login go to the bottom
        if (!a.lastLoginAt && !b.lastLoginAt) return 0;
        if (!a.lastLoginAt) return 1;
        if (!b.lastLoginAt) return -1;

        // Compare dates (both are locale strings, need to convert back to Date for comparison)
        const dateA = new Date(a.lastLoginAt);
        const dateB = new Date(b.lastLoginAt);
        return dateB.getTime() - dateA.getTime(); // Descending order
      });

      setActive(items);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load active users");
      setMessageType("error");
    }
  }

  // Acquire a short-lived JWT on mount
  useEffect(() => {
    async function getToken() {
      try {
        const res = await fetch("/api/web-token");
        const data = await res.json();
        if (res.ok && data?.token) {
          setJwt(data.token);
        } else {
          setMessage(data?.error || "Failed to obtain auth token");
        }
      } catch (e: any) {
        setMessage(e?.message || "Failed to obtain auth token");
      }
    }
    getToken();
  }, []);

  // Fetch pending and active users once JWT is available
  useEffect(() => {
    if (!jwt) return;
    fetchPending();
    fetchActive();
    // Intentionally only depends on jwt to refetch if token is refreshed
  }, [jwt]);

  async function handleAddUsers(emails: string[]) {
    setSubmitting(true);
    setMessage(null);
    setMessageType("info");

    try {
      let successCount = 0;
      let alreadyActiveCount = 0;
      let resentCount = 0;
      const errors: string[] = [];

      // Process emails one by one to get detailed feedback
      for (const email of emails) {
        try {
          const res = await fetch("/api/admin/addUser", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
            },
            credentials: "include",
            body: JSON.stringify({ email }),
          });
          const data = await res.json();

          if (!res.ok) {
            errors.push(`${email}: ${data?.error || "Failed to add"}`);
          } else {
            // Interpret backend messages
            if (data?.message === "already active") {
              alreadyActiveCount++;
            } else if (data?.message === "resent") {
              resentCount++;
            } else if (data?.message === "created") {
              successCount++;
            } else {
              successCount++; // Default to success
            }
          }
        } catch (e: any) {
          errors.push(`${email}: ${e?.message || "Failed to add"}`);
        }
      }

      // Generate summary message
      const parts: string[] = [];
      if (successCount > 0) {
        parts.push(`${successCount} invitation${successCount === 1 ? "" : "s"} sent`);
      }
      if (resentCount > 0) {
        parts.push(`${resentCount} invitation${resentCount === 1 ? "" : "s"} resent`);
      }
      if (alreadyActiveCount > 0) {
        parts.push(`${alreadyActiveCount} user${alreadyActiveCount === 1 ? " was" : "s were"} already active`);
      }

      if (parts.length > 0) {
        setMessage(parts.join(", "));
        setMessageType("info");
      }

      if (errors.length > 0) {
        if (parts.length === 0) {
          // All failed
          setMessage(`Failed to add users: ${errors.join("; ")}`);
          setMessageType("error");
        } else {
          // Some succeeded, some failed
          setMessage(`${parts.join(", ")}. Errors: ${errors.join("; ")}`);
          setMessageType("info");
        }
      }

      // Refresh the lists
      await fetchPending();
      await fetchActive();
    } catch (e: any) {
      setMessage(e?.message || "Failed to add users");
      setMessageType("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend(targetEmail: string) {
    setMessage(null);
    setMessageType("info");
    try {
      const res = await fetch("/api/admin/resendActivation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ email: targetEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to resend");
      setMessage(`Resent to ${targetEmail}`);
      setMessageType("info");
      await fetchPending();
      await fetchActive();
    } catch (e: any) {
      setMessage(e?.message || "Failed to resend");
      setMessageType("error");
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
            className={`mb-4 rounded border p-3 text-sm ${
              messageType === "error" ? "border-red-300 bg-red-50 text-red-800" : "border-yellow-300 bg-yellow-50"
            }`}
          >
            {message}
          </div>
        )}

        <div>
          <h2 className="text-xl font-semibold mb-2">Pending Users</h2>
          {loading ? (
            <div>Loading…</div>
          ) : pending.length === 0 ? (
            <div className="text-sm text-gray-600">No pending users</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">Email</th>
                  <th className="py-2">Invited</th>
                  <th className="py-2">Expires</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((u) => (
                  <tr key={u.email} className="border-b">
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">{u.invitedAt || "–"}</td>
                    <td className="py-2">{u.expiresAt || "–"}</td>
                    <td className="py-2">
                      <button className="rounded bg-gray-700 px-3 py-1 text-white" onClick={() => onResend(u.email)}>
                        Resend
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-2">Active Users</h2>
          {loading ? (
            <div>Loading…</div>
          ) : active.length === 0 ? (
            <div className="text-sm text-gray-600">No active users</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-6">Name</th>
                  <th className="py-2 pr-6">Email</th>
                  <th className="py-2 pr-6">Role</th>
                  <th className="py-2 pr-6">Last Login</th>
                  <th className="py-2">Entitlements</th>
                </tr>
              </thead>
              <tbody>
                {active.map((u) => (
                  <tr key={u.email} className="border-b">
                    <td className="py-2 pr-6">
                      <a
                        className="text-blue-600 underline hover:text-blue-800"
                        href={`/admin/users/${encodeURIComponent(u.email)}`}
                      >
                        {getDisplayName(u)}
                      </a>
                    </td>
                    <td className="py-2 pr-6">{u.email}</td>
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
                ))}
              </tbody>
            </table>
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
