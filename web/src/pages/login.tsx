import { useEffect, useRef, useState } from "react";
import { SiteConfig } from "@/types/siteConfig";
import { getSiteName, getTagline } from "@/utils/client/siteConfig";
import Image from "next/image";
import { fetchWithAuth } from "@/utils/client/tokenManager";

interface LoginProps {
  siteConfig: SiteConfig | null;
}

export default function Login({ siteConfig }: LoginProps) {
  const [step, setStep] = useState<"email" | "verify-access">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [lastSendType, setLastSendType] = useState<"login" | "activation" | null>(null);
  const [showPasswordInfo, setShowPasswordInfo] = useState(false);
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  // Tick countdown while active; when it reaches 0, re-enable button
  useEffect(() => {
    if (!emailSent) return;
    if (resendSeconds <= 0) {
      setEmailSent(false);
      return;
    }
    const t = setTimeout(() => setResendSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [emailSent, resendSeconds]);

  // Desktop-only autofocus for the email field on initial email step
  useEffect(() => {
    if (step !== "email") return;
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const isDesktop = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (isDesktop && emailInputRef.current) {
      emailInputRef.current.focus();
    }
  }, [step]);

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setIsSubmitting(true);

    if (!email.trim()) {
      setError("Email cannot be empty");
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetchWithAuth("/api/auth/requestLoginLink", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          redirect:
            typeof window !== "undefined"
              ? new URLSearchParams(window.location.search).get("redirect") || undefined
              : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message === "login-link-sent") {
          setInfo("We sent you a sign-in link. Please check your email.");
          setEmailSent(true);
          setResendSeconds(60);
          setLastSendType("login");
          setIsSubmitting(false);
          return;
        }
        if (data.message === "activation-resent") {
          setInfo("We re-sent your activation link. Please check your email.");
          setEmailSent(true);
          setResendSeconds(60);
          setLastSendType("activation");
          setIsSubmitting(false);
          return;
        }
        if (data.next === "verify-access") {
          setStep("verify-access");
          setIsSubmitting(false);
          return;
        }
        setInfo("Check your email for further instructions.");
        setEmailSent(true);
        setResendSeconds(60);
        setLastSendType("login");
        setIsSubmitting(false);
      } else if (res.status === 429) {
        setError("Too many attempts. Please try again later.");
        setIsSubmitting(false);
      } else {
        const errorData = await res.json();
        setError(errorData.error || "Something went wrong");
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error("Login error:", error);
      setError("An error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  const submitVerifyAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setIsSubmitting(true);

    if (!email.trim()) {
      setError("Email cannot be empty");
      setIsSubmitting(false);
      return;
    }
    if (!password.trim()) {
      setError("Password cannot be empty");
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetchWithAuth("/api/auth/verifyAccess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, sharedPassword: password }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message === "created") setInfo("Invitation sent. Please check your email.");
        else if (data.message === "activation-resent") setInfo("Activation re-sent. Please check your email.");
        else if (data.message === "already active")
          setInfo("Your account is already active. Check your email for a sign-in link.");
        setEmailSent(true);
        setResendSeconds(60);
        setLastSendType(data.message === "already active" ? "login" : "activation");
        setIsSubmitting(false);
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts. Please try again later.");
        setIsSubmitting(false);
        return;
      }
      const errorData = await res.json();
      setError(errorData.error || "Incorrect password");
      setIsSubmitting(false);
    } catch (err) {
      console.error(err);
      setError("An error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      {siteConfig?.loginImage && (
        <div className="flex flex-col items-center mb-6 w-full max-w-md">
          <Image
            src={`/${siteConfig.loginImage}`}
            alt="Login Image"
            width={250}
            height={250}
            className="w-full h-auto object-contain"
          />
        </div>
      )}
      <form
        onSubmit={step === "email" ? submitEmail : submitVerifyAccess}
        className="p-6 bg-white rounded shadow-md max-w-md w-full"
        aria-busy={isSubmitting}
      >
        <h1 className="mb-4 text-2xl">Welcome to {getSiteName(siteConfig)}!</h1>
        <p className="mb-4">{getTagline(siteConfig)}</p>

        {step === "email" && (
          <div className="mb-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              ref={emailInputRef}
              className="p-2 border border-gray-300 rounded w-full"
              placeholder="Enter your email"
            />
          </div>
        )}

        {step === "verify-access" && (
          <>
            <div className="mb-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="p-2 border border-gray-300 rounded w-full"
                placeholder="Enter your email"
              />
            </div>
            <div className="relative mb-2">
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium text-gray-700">Shared Password</label>
                <button
                  type="button"
                  onClick={() => setShowPasswordInfo(true)}
                  className="w-4 h-4 rounded-full bg-gray-400 text-white text-xs flex items-center justify-center hover:bg-gray-500 transition-colors"
                  title="Why do I need the shared password?"
                >
                  ?
                </button>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="p-2 border border-gray-300 rounded w-full"
                placeholder="Enter shared password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 p-2 text-gray-600"
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
            {siteConfig?.siteId === "ananda" && (
              <p className="mt-1 mb-4 text-sm">
                Those with Ananda Library access can get the password from&nbsp;
                <a
                  href="https://www.anandalibrary.org/content/ai-chatbot-intro/"
                  className="text-blue-500 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  this page in the Ananda Library
                </a>
              </p>
            )}
          </>
        )}

        {error && <p className="text-red-500 mb-2">{error}</p>}
        {info && (
          <p className="text-green-600 mb-2" aria-live="polite">
            {info}
          </p>
        )}
        <div className="flex items-center justify-between mt-4">
          <button
            type="submit"
            className="p-2 bg-blue-500 text-white rounded disabled:opacity-60"
            disabled={isSubmitting || emailSent}
          >
            {isSubmitting
              ? "Processing…"
              : emailSent
                ? "Check your email"
                : step === "email"
                  ? "Continue"
                  : "Verify access"}
          </button>
          {emailSent && resendSeconds > 0 && (
            <span className="ml-3 text-sm text-gray-600" aria-live="polite">
              You can resend the {lastSendType === "activation" ? "invitation email" : "login link"} in {resendSeconds}s
            </span>
          )}
        </div>
      </form>
      {step === "email" && siteConfig?.siteId === "ananda" && (
        <p className="mt-4 text-center text-sm text-gray-700">
          If your email isn’t recognized, we’ll ask for the shared password on the next step.
        </p>
      )}
      {siteConfig?.siteId === "jairam" && (
        <p className="mt-4 text-center">For access, please contact the Free Joe Hunt team.</p>
      )}
      <p className="mt-4">
        <a
          href="https://github.com/anandaworldwide/ananda-library-chatbot"
          className="text-blue-400 hover:underline mx-2"
        >
          Open Source Project
        </a>
      </p>

      {/* Password Info Modal */}
      {showPasswordInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Why do I need the shared password?</h3>
              <button
                type="button"
                onClick={() => setShowPasswordInfo(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="text-gray-700 space-y-3">
              <p>
                We're transitioning from a shared password system to individual user accounts for better security and
                personalization.
              </p>
              <p>
                To set up your personal account, please enter the shared password that you used to access the site
                previously. This will verify your existing access and create your individual login.
              </p>
              <p className="text-sm text-gray-600">
                After your account is created, you'll receive login links via email and won't need the shared password
                anymore.
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPasswordInfo(false)}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
