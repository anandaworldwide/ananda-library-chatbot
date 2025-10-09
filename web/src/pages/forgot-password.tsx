import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { SiteConfig } from "@/types/siteConfig";
import { getSiteName } from "@/utils/client/siteConfig";
import Layout from "@/components/layout";

interface ForgotPasswordProps {
  siteConfig: SiteConfig | null;
}

export default function ForgotPasswordPage({ siteConfig }: ForgotPasswordProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill email from query parameter if present
  useEffect(() => {
    if (router.isReady && router.query.email && typeof router.query.email === "string") {
      setEmail(decodeURIComponent(router.query.email));
    }
  }, [router.isReady, router.query.email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("Email is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/requestPasswordReset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setSuccess(true);
        setIsSubmitting(false);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to send reset link");
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error("Forgot password error:", error);
      setError("An error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <>
        <Head>
          <title>Check Your Email - {getSiteName(siteConfig)}</title>
        </Head>
        <Layout siteConfig={siteConfig}>
          <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <div className="p-6 bg-white rounded shadow-md max-w-md w-full">
              <h1 className="mb-4 text-2xl font-semibold text-green-600">Check Your Email</h1>
              <p className="mb-4 text-gray-700">
                If an account exists with that email address, a password reset link has been sent.
              </p>
              <p className="mb-6 text-gray-600 text-sm">
                The link will expire in one hour. If you don't see the email, check your spam folder.
              </p>
              <Link
                href="/login"
                className="block w-full p-2 bg-blue-500 text-white rounded text-center hover:bg-blue-600"
              >
                Back to Login
              </Link>
            </div>
          </div>
        </Layout>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Forgot Password - {getSiteName(siteConfig)}</title>
      </Head>
      <Layout siteConfig={siteConfig}>
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
          <div className="p-6 bg-white rounded shadow-md max-w-md w-full">
            <h1 className="mb-4 text-2xl font-semibold">Forgot Your Password?</h1>
            <p className="mb-6 text-gray-600">
              Enter your email address and we'll send you a link to reset your password.
            </p>

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="p-2 border border-gray-300 rounded w-full"
                  placeholder="Enter your email"
                  autoComplete="email"
                />
              </div>

              {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  className="w-full p-2 bg-blue-500 text-white rounded disabled:opacity-60 hover:bg-blue-600"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Send Reset Link"}
                </button>
                <Link
                  href="/login"
                  className="w-full p-2 bg-gray-200 text-gray-700 rounded text-center hover:bg-gray-300"
                >
                  Back to Login
                </Link>
              </div>
            </form>
          </div>
        </div>
      </Layout>
    </>
  );
}

export async function getServerSideProps() {
  const { loadSiteConfigSync } = await import("@/utils/server/loadSiteConfig");
  const siteConfig = loadSiteConfigSync();

  return {
    props: {
      siteConfig,
    },
  };
}
