import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { SiteConfig } from "@/types/siteConfig";
import { PasswordValidation } from "@/types/user";
import { PasswordStrengthIndicator } from "@/components/PasswordStrengthIndicator";
import { getSiteName } from "@/utils/client/siteConfig";
import { fetchWithAuth } from "@/utils/client/tokenManager";
import Layout from "@/components/layout";

interface ResetPasswordProps {
  siteConfig: SiteConfig | null;
}

export default function ResetPasswordPage({ siteConfig }: ResetPasswordProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validation, setValidation] = useState<PasswordValidation | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Extract token and email from URL query params
  useEffect(() => {
    if (router.isReady) {
      const { token: tokenParam, email: emailParam } = router.query;
      if (typeof tokenParam === "string") setToken(tokenParam);
      if (typeof emailParam === "string") setEmail(emailParam);
    }
  }, [router.isReady, router.query]);

  // Validate password strength as user types
  useEffect(() => {
    if (!password) {
      setValidation(null);
      return;
    }

    const requirements = {
      minLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
    };

    const allMet =
      requirements.minLength && requirements.hasUppercase && requirements.hasLowercase && requirements.hasNumber;

    setValidation({
      valid: allMet,
      requirements,
    });
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token || !email) {
      setError("Invalid reset link");
      return;
    }

    if (!password) {
      setError("Password is required");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!validation?.valid) {
      setError("Password does not meet all requirements");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetchWithAuth("/api/auth/resetPassword", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, email, password }),
      });

      if (res.ok) {
        setSuccess(true);
        setIsSubmitting(false);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to reset password");
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error("Reset password error:", error);
      setError("An error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <>
        <Head>
          <title>Password Reset Successfully - {getSiteName(siteConfig)}</title>
        </Head>
        <Layout siteConfig={siteConfig}>
          <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <div className="p-6 bg-white rounded shadow-md max-w-md w-full">
              <h1 className="mb-4 text-2xl font-semibold text-green-600">Password Reset Successfully!</h1>
              <p className="mb-6 text-gray-700">
                Your password has been changed. You can now log in with your new password.
              </p>
              <Link
                href="/login"
                className="block w-full p-2 bg-blue-500 text-white rounded text-center hover:bg-blue-600"
              >
                Go to Login
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
        <title>Reset Password - {getSiteName(siteConfig)}</title>
      </Head>
      <Layout siteConfig={siteConfig}>
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
          <div className="p-6 bg-white rounded shadow-md max-w-md w-full">
            <h1 className="mb-4 text-2xl font-semibold">Reset Your Password</h1>
            <p className="mb-6 text-gray-600">Enter your new password below.</p>

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="p-2 border border-gray-300 rounded w-full pr-10"
                    placeholder="Enter your new password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <PasswordStrengthIndicator validation={validation} password={password} />
              </div>

              <div className="mb-4">
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="p-2 border border-gray-300 rounded w-full pr-10"
                    placeholder="Confirm your new password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  className="w-full p-2 bg-blue-500 text-white rounded disabled:opacity-60 hover:bg-blue-600"
                  disabled={isSubmitting || !validation?.valid}
                >
                  {isSubmitting ? "Resetting Password..." : "Reset Password"}
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
