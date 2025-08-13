// Admin Dashboard (temporary): gated by sudo cookie (SSR); shows Bootstrap button when enabled
import React, { useState } from "react";
import Head from "next/head";
import type { GetServerSideProps, NextApiRequest, NextApiResponse } from "next";
import { isAdminPageAllowed } from "@/utils/server/adminPageGate";
import Layout from "@/components/layout";
import { SiteConfig } from "@/types/siteConfig";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import Link from "next/link";

interface AdminDashboardProps {
  isSudoAdmin: boolean;
  bootstrapEnabled: boolean;
  siteConfig: SiteConfig | null;
}

export default function AdminDashboardPage({ isSudoAdmin, bootstrapEnabled, siteConfig }: AdminDashboardProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleBootstrap() {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/bootstrap", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || "Bootstrap failed");
      setMessage("Bootstrap completed");
    } catch (e: any) {
      setMessage(e?.message || "Bootstrap failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isSudoAdmin) {
    return (
      <Layout siteConfig={siteConfig}>
        <div className="mx-auto max-w-3xl p-6">
          <h1 className="text-2xl font-semibold mb-4">Admin Dashboard</h1>
          <div className="rounded border bg-yellow-50 p-3 text-sm">Access denied. Set sudo cookie to proceed.</div>
        </div>
      </Layout>
    );
  }

  const loginRequired = !!siteConfig?.requireLogin;

  return (
    <Layout siteConfig={siteConfig}>
      <Head>
        <title>Admin · Dashboard</title>
      </Head>
      <div className="mx-auto max-w-3xl p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Admin · Dashboard</h1>

        {message && <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">{message}</div>}

        {loginRequired && bootstrapEnabled ? (
          <section className="rounded border p-4">
            <h2 className="text-lg font-semibold mb-2">Bootstrap</h2>
            <button
              className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
              onClick={handleBootstrap}
              disabled={busy}
            >
              {busy ? "Bootstrapping…" : "Bootstrap"}
            </button>
          </section>
        ) : null}

        {loginRequired ? (
          <section className="rounded border p-4">
            <h2 className="text-lg font-semibold mb-2">User Management</h2>
            <a href="/admin/users" className="text-blue-600 underline">
              Go to Users
            </a>
          </section>
        ) : null}

        <section className="rounded border p-4">
          <h2 className="text-lg font-semibold mb-2">Admin Tools</h2>
          <div className="flex flex-col space-y-2">
            <Link href="/admin/downvotes" className="text-blue-600 underline inline-flex items-center">
              Review Downvotes
              <span className="material-icons text-sm ml-1">thumb_down</span>
            </Link>
            <Link href="/admin/relatedQuestionsUpdater" className="text-blue-600 underline inline-flex items-center">
              Related Qs Updater
              <span className="material-icons text-sm ml-1">update</span>
            </Link>
          </div>
        </section>

        {loginRequired ? (
          <section className="rounded border p-4">
            <h2 className="text-lg font-semibold mb-2">Bind UUID to Account</h2>
            <p className="text-sm text-gray-600 mb-2">
              Binds this browser's uuid cookie to the specified user email. Sudo only.
            </p>
            <BindUuidForm onResult={(t) => setMessage(t)} />
          </section>
        ) : null}
      </div>
    </Layout>
  );
}

function BindUuidForm({ onResult }: { onResult: (msg: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        onResult("");
        setBusy(true);
        try {
          const res = await fetch("/api/admin/bindUuid", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ email }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Failed to bind uuid");
          onResult(`UUID bound: ${data.uuid}`);
          setEmail("");
        } catch (e: any) {
          onResult(e?.message || "Failed to bind uuid");
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-2"
    >
      <input
        type="email"
        className="w-full rounded border px-3 py-2"
        placeholder="user@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button type="submit" disabled={busy} className="rounded bg-gray-800 px-3 py-1 text-white disabled:opacity-50">
        {busy ? "Binding…" : "Bind UUID"}
      </button>
    </form>
  );
}

export const getServerSideProps: GetServerSideProps<AdminDashboardProps> = async (ctx) => {
  const req = ctx.req as unknown as NextApiRequest;
  const res = ctx.res as unknown as NextApiResponse;
  const siteConfig = await loadSiteConfig();
  const allowed = isAdminPageAllowed(req, res, siteConfig);
  if (!allowed) return { notFound: true };
  const bootstrapEnabled =
    process.env.ENABLE_ADMIN_BOOTSTRAP === "true" || process.env.NEXT_PUBLIC_ENABLE_ADMIN_BOOTSTRAP === "true";
  // For render, treat allowed as sudo/admin presence
  return { props: { isSudoAdmin: true, bootstrapEnabled, siteConfig } };
};
