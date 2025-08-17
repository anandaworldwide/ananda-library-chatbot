// Email change verification page: consumes token/email from query, calls /api/verifyEmailChange
import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Layout from "@/components/layout";
import type { GetServerSideProps } from "next";
import type { SiteConfig } from "@/types/siteConfig";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";

interface VerifyEmailChangeProps {
  siteConfig: SiteConfig | null;
}

export default function VerifyEmailChangePage({ siteConfig }: VerifyEmailChangeProps) {
  const router = useRouter();
  const { token, email } = router.query as { token?: string; email?: string };
  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!token || !email || status !== "idle") return;

    setStatus("verifying");
    (async () => {
      try {
        const res = await fetch("/api/verifyEmailChange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, email: decodeURIComponent(email) }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || "Email verification failed");
        }

        setStatus("success");
        setMessage(`Email address successfully updated to ${data.newEmail || email}`);

        // Redirect to settings after 3 seconds
        setTimeout(() => {
          router.replace("/settings");
        }, 3000);
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message || "Email verification failed");
      }
    })();
  }, [token, email, status, router]);

  const getStatusIcon = () => {
    switch (status) {
      case "verifying":
        return <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>;
      case "success":
        return (
          <div className="rounded-full bg-green-100 p-3 mx-auto mb-4 w-fit">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        );
      case "error":
        return (
          <div className="rounded-full bg-red-100 p-3 mx-auto mb-4 w-fit">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        );
      default:
        return null;
    }
  };

  const getStatusTitle = () => {
    switch (status) {
      case "verifying":
        return "Verifying Email Change";
      case "success":
        return "Email Updated Successfully";
      case "error":
        return "Verification Failed";
      default:
        return "Email Verification";
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case "verifying":
        return "Please wait while we verify your email change...";
      case "success":
        return message || "Your email address has been updated successfully. Redirecting to settings...";
      case "error":
        return message || "We couldn't verify your email change. Please try again or request a new verification link.";
      default:
        return "Preparing verification...";
    }
  };

  return (
    <>
      <Head>
        <title>Verify Email Change</title>
      </Head>
      <Layout siteConfig={siteConfig}>
        <main className="mx-auto max-w-md p-6 w-full">
          <div className="text-center">
            {getStatusIcon()}
            <h1 className="text-2xl font-semibold mb-4">{getStatusTitle()}</h1>
            <p className="text-gray-600 mb-6">{getStatusMessage()}</p>

            {status === "error" && (
              <div className="space-y-3">
                <button
                  onClick={() => router.push("/settings")}
                  className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  Go to Settings
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full rounded bg-gray-600 px-4 py-2 text-white hover:bg-gray-700"
                >
                  Try Again
                </button>
              </div>
            )}

            {status === "success" && (
              <div className="text-sm text-gray-500">You will be automatically redirected in a few seconds...</div>
            )}
          </div>
        </main>
      </Layout>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  const siteConfig = await loadSiteConfig();
  if (!siteConfig?.requireLogin) {
    return { notFound: true };
  }
  return { props: { siteConfig } } as any;
};
