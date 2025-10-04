import React from "react";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import Layout from "@/components/layout";
import type { SiteConfig } from "@/types/siteConfig";

interface UnauthorizedPageProps {
  siteConfig: SiteConfig | null;
}

export default function UnauthorizedPage({ siteConfig }: UnauthorizedPageProps) {
  return (
    <>
      <Head>
        <title>Unauthorized Access</title>
      </Head>
      <Layout siteConfig={siteConfig}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="mb-6">
              <span className="material-icons text-red-500 text-6xl">lock</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Access Denied</h1>
            <p className="text-gray-600 mb-6">
              You are not authorized to access this page. This area is restricted to administrators only.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/"
                className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <span className="material-icons text-sm mr-2">home</span>
                Go to Home
              </Link>
              {siteConfig?.requireLogin && (
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                >
                  <span className="material-icons text-sm mr-2">login</span>
                  Login
                </Link>
              )}
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<UnauthorizedPageProps> = async () => {
  const siteConfig = await loadSiteConfig();
  return { props: { siteConfig } };
};
