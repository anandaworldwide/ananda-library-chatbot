// Admin Dashboard (temporary): gated by sudo cookie (SSR); shows Bootstrap button when enabled
import React, { useState } from "react";
import Head from "next/head";
import type { GetServerSideProps, NextApiRequest, NextApiResponse } from "next";
import { isAdminPageAllowed } from "@/utils/server/adminPageGate";
import Layout from "@/components/layout";
import { SiteConfig } from "@/types/siteConfig";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";

interface AdminDashboardProps {
  isSudoAdmin: boolean;
  siteConfig: SiteConfig | null;
}

export default function AdminDashboardPage({ isSudoAdmin, siteConfig }: AdminDashboardProps) {
  const [message] = useState<string | null>(null);

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
        <Breadcrumb items={[{ label: "Admin Dashboard" }]} />

        {message && <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">{message}</div>}

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
          </div>
        </section>
      </div>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<AdminDashboardProps> = async (ctx) => {
  const req = ctx.req as unknown as NextApiRequest;
  const res = ctx.res as unknown as NextApiResponse;
  const siteConfig = await loadSiteConfig();
  const allowed = await isAdminPageAllowed(req, res, siteConfig);
  if (!allowed) return { notFound: true };
  // For render, treat allowed as sudo/admin presence
  return { props: { isSudoAdmin: true, siteConfig } };
};
