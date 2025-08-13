import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Layout from "@/components/layout";
import { SiteConfig } from "@/types/siteConfig";
import type { GetServerSideProps, NextApiRequest } from "next";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { getSudoCookie } from "@/utils/server/sudoCookieUtils";

interface UserDetail {
  id: string;
  email: string;
  uuid: string | null;
  role: string;
  inviteStatus: string | null;
  verifiedAt: string | null;
  lastLoginAt: string | null;
  entitlements: Record<string, any>;
}

interface PageProps {
  siteConfig: SiteConfig | null;
}

export default function EditUserPage({ siteConfig }: PageProps) {
  const router = useRouter();
  const { userId } = router.query as { userId?: string };
  const [jwt, setJwt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("user");

  useEffect(() => {
    async function getToken() {
      try {
        const res = await fetch("/api/web-token");
        const data = await res.json();
        if (res.ok && data?.token) setJwt(data.token);
      } catch (e) {}
    }
    getToken();
  }, []);

  useEffect(() => {
    if (!jwt || !userId) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userId as string)}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load user");
        const u = data.user as UserDetail;
        setUser(u);
        setEmail(u.email);
        setRole(u.role || "user");
      } catch (e: any) {
        setError(e?.message || "Failed to load user");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [jwt, userId]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save");
      setUser(data.user as UserDetail);
      if (data.user.id !== user.id) {
        // Email changed → navigate to new route
        router.replace(`/admin/users/${encodeURIComponent(data.user.id)}`);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout siteConfig={siteConfig}>
      <Head>
        <title>Admin · Edit User</title>
      </Head>
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold mb-4">Admin · Edit User</h1>
        {loading ? (
          <div>Loading…</div>
        ) : error ? (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        ) : !user ? (
          <div className="text-sm text-gray-700">User not found</div>
        ) : (
          <form onSubmit={onSave} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="w-full rounded border px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-600">Changing email keeps UUID and sessions intact.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <select className="rounded border px-3 py-2" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="user">user</option>
                <option value="admin">admin</option>
                <option value="superuser">superuser</option>
              </select>
              <p className="mt-1 text-xs text-gray-600">Only superusers can change roles.</p>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button type="button" className="rounded px-4 py-2 border" onClick={() => router.push("/admin/users")}>
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<PageProps> = async ({ req }) => {
  const siteConfig = await loadSiteConfig();
  const sudoStatus = getSudoCookie(req as NextApiRequest);
  if (!sudoStatus.sudoCookieValue) return { notFound: true };
  return { props: { siteConfig } };
};
