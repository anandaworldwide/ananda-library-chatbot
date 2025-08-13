// Admin Users page: Add User form and Pending Users list with Resend
import React, { useEffect, useState } from "react";
import Head from "next/head";
import Layout from "@/components/layout";
import { SiteConfig } from "@/types/siteConfig";
import type { GetServerSideProps, NextApiRequest } from "next";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { getSudoCookie } from "@/utils/server/sudoCookieUtils";

interface PendingUser {
  email: string;
  invitedAt: string | null;
  expiresAt: string | null;
}

interface ActiveUser {
  email: string;
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

export default function AdminUsersPage({ siteConfig }: AdminUsersPageProps) {
  const [email, setEmail] = useState("");
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
        uuid: it.uuid ?? null,
        role: it.role || undefined,
        verifiedAt: it.verifiedAt ? new Date(it.verifiedAt).toLocaleString() : null,
        lastLoginAt: it.lastLoginAt ? new Date(it.lastLoginAt).toLocaleString() : null,
        entitlements: it.entitlements || {},
      }));
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setMessage("Enter a valid email");
      setMessageType("error");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    setMessageType("info");
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
      if (!res.ok) throw new Error(data?.error || "Failed to add user");
      // Interpret backend messages for UI clarity
      if (data?.message === "already active") {
        setMessage("Not added: user already exists and is active");
        setMessageType("error");
      } else if (data?.message === "resent") {
        setMessage(`Activation email resent to ${email.toLowerCase()}`);
        setMessageType("info");
      } else if (data?.message === "created") {
        setMessage("User created and activation email sent");
        setMessageType("info");
      } else {
        setMessage(data?.message || "User processed");
        setMessageType("info");
      }
      setEmail("");
      await fetchPending();
      await fetchActive();
    } catch (e: any) {
      setMessage(e?.message || "Failed to add user");
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
        <h1 className="text-2xl font-semibold mb-4">Admin · Users</h1>

        <form onSubmit={onSubmit} className="mb-8 space-y-3">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded border px-3 py-2"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Add User"}
          </button>
        </form>

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
                  <th className="py-2">Email</th>
                  <th className="py-2">UUID</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Verified</th>
                  <th className="py-2">Last Login</th>
                  <th className="py-2">Entitlements</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((u) => (
                  <tr key={u.email} className="border-b">
                    <td className="py-2">{u.email}</td>
                    <td className="py-2 font-mono text-xs text-gray-700">{u.uuid || "–"}</td>
                    <td className="py-2">{u.role || "–"}</td>
                    <td className="py-2">{u.verifiedAt || "–"}</td>
                    <td className="py-2">{u.lastLoginAt || "–"}</td>
                    <td className="py-2">
                      {Object.keys(u.entitlements).length > 0
                        ? Object.keys(u.entitlements)
                            .filter((key) => u.entitlements[key])
                            .join(", ")
                        : "–"}
                    </td>
                    <td className="py-2">
                      <a className="text-blue-600 underline" href={`/admin/users/${encodeURIComponent(u.email)}`}>
                        Edit
                      </a>
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
  const sudoStatus = getSudoCookie(req as NextApiRequest);
  if (!sudoStatus.sudoCookieValue) {
    return { notFound: true };
  }
  return { props: { siteConfig, isSudoAdmin: true } };
};
