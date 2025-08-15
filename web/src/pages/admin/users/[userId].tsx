import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Layout from "@/components/layout";
import { SiteConfig } from "@/types/siteConfig";
import type { GetServerSideProps, NextApiRequest } from "next";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { isAdminPageAllowed } from "@/utils/server/adminPageGate";
import { Breadcrumb } from "@/components/Breadcrumb";

interface UserDetail {
  id: string;
  email: string;
  uuid: string | null;
  role: string;
  inviteStatus: string | null;
  verifiedAt: string | null;
  lastLoginAt: string | null;
  entitlements: Record<string, any>;
  firstName?: string | null;
  lastName?: string | null;
}

interface PageProps {
  siteConfig: SiteConfig | null;
}

// Helper function to get display name
function getDisplayName(user: UserDetail): string {
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
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        setFirstName(typeof u.firstName === "string" ? u.firstName : "");
        setLastName(typeof u.lastName === "string" ? u.lastName : "");
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
        body: JSON.stringify({ email, role, firstName: firstName.trim(), lastName: lastName.trim() }),
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

  async function onDelete() {
    if (!user || !jwt) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to delete user");

      // Redirect to users list after successful deletion
      router.push("/admin/users");
    } catch (e: any) {
      setError(e?.message || "Failed to delete user");
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Layout siteConfig={siteConfig}>
      <Head>
        <title>Admin · Edit User</title>
      </Head>
      <div className="mx-auto max-w-3xl p-6">
        <Breadcrumb
          items={[
            { label: "Admin Dashboard", href: "/admin" },
            { label: "Users", href: "/admin/users" },
            { label: user ? getDisplayName(user) : "User" },
          ]}
        />
        {loading ? (
          <div>Loading…</div>
        ) : error ? (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        ) : !user ? (
          <div className="text-sm text-gray-700">User not found</div>
        ) : (
          <>
            {/* User Information Section */}
            <div className="mb-6 rounded border bg-gray-50 p-4">
              <h2 className="text-lg font-semibold mb-3">User Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">UUID:</span>
                  <div className="mt-1 font-mono text-xs bg-white p-2 rounded border">{user.uuid || "–"}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Verified:</span>
                  <div className="mt-1">
                    {user.verifiedAt ? (
                      <span className="text-green-600">✓ {new Date(user.verifiedAt).toLocaleString()}</span>
                    ) : (
                      <span className="text-gray-500">Not verified</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Last Login:</span>
                  <div className="mt-1">
                    {user.lastLoginAt ? (
                      new Date(user.lastLoginAt).toLocaleString()
                    ) : (
                      <span className="text-gray-500">Never</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Invite Status:</span>
                  <div className="mt-1">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        user.inviteStatus === "accepted"
                          ? "bg-green-100 text-green-800"
                          : user.inviteStatus === "pending"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {user.inviteStatus || "unknown"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={onSave} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium mb-1">
                    First name
                  </label>
                  <input
                    id="firstName"
                    className="w-full rounded border px-3 py-2"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium mb-1">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    className="w-full rounded border px-3 py-2"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                  />
                </div>
              </div>
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
              <div className="flex justify-between">
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    className="rounded px-4 py-2 border"
                    onClick={() => router.push("/admin/users")}
                  >
                    Back
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(true)}
                  className="inline-flex items-center rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 transition-colors"
                >
                  Delete User
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && user && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Delete User</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <strong>{getDisplayName(user)}</strong> ({user.email})?
              <br />
              <br />
              <span className="text-red-600 font-medium">This action cannot be undone.</span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<PageProps> = async ({ req }) => {
  const siteConfig = await loadSiteConfig();
  const allowed = await isAdminPageAllowed(req as NextApiRequest, undefined as any, siteConfig);
  if (!allowed) return { notFound: true };
  return { props: { siteConfig } };
};
