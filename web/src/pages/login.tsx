import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { SiteConfig } from "@/types/siteConfig";
import { getSiteName, getTagline } from "@/utils/client/siteConfig";
import Image from "next/image";
import { fetchWithAuth } from "@/utils/client/tokenManager";
import AdminApproverSelector from "@/components/AdminApproverSelector";
import FeedbackButton from "@/components/FeedbackButton";
import FeedbackModal from "@/components/FeedbackModal";

interface LoginProps {
  siteConfig: SiteConfig | null;
}

export default function Login({ siteConfig }: LoginProps) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "request-approval">("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [lastSendType, setLastSendType] = useState<"login" | "activation" | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
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
        if (data.next === "request-approval") {
          setStep("request-approval");
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

  const handleApprovalSuccess = () => {
    router.push("/request-submitted");
  };

  const handleApprovalError = (errorMessage: string) => {
    setError(errorMessage);
  };

  const handleBackToEmail = () => {
    setStep("email");
    setError("");
    setInfo("");
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
      <div className="p-6 bg-white rounded shadow-md max-w-md w-full">
        <h1 className="mb-4 text-2xl">Welcome to {getSiteName(siteConfig)}!</h1>
        <p className="mb-4">{getTagline(siteConfig)}</p>

        {step === "email" && (
          <form onSubmit={submitEmail} aria-busy={isSubmitting}>
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
                {isSubmitting ? "Processing…" : emailSent ? "Check your email" : "Continue"}
              </button>
              {emailSent && resendSeconds > 0 && (
                <span className="ml-3 text-sm text-gray-600" aria-live="polite">
                  You can resend the {lastSendType === "activation" ? "invitation email" : "login link"} in{" "}
                  {resendSeconds}s
                </span>
              )}
            </div>
          </form>
        )}

        {step === "request-approval" && (
          <div>
            <AdminApproverSelector
              requesterEmail={email}
              onSuccess={handleApprovalSuccess}
              onError={handleApprovalError}
              onBack={handleBackToEmail}
            />

            <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
              <p>
                Don't see an admin for your area? Please{" "}
                <button
                  type="button"
                  onClick={() => setShowFeedbackModal(true)}
                  className="text-blue-500 underline hover:text-blue-700"
                >
                  click here
                </button>{" "}
                to contact us directly and request an account.
              </p>
            </div>

            {error && <p className="text-red-500 mt-4">{error}</p>}
            {info && (
              <p className="text-green-600 mt-4" aria-live="polite">
                {info}
              </p>
            )}
          </div>
        )}
      </div>
      {step === "email" && siteConfig?.siteId === "ananda" && (
        <p className="mt-4 text-center text-sm text-gray-700">
          If your email isn't recognized, we'll help you request access from an admin.
        </p>
      )}
      {siteConfig?.siteId === "jairam" && (
        <p className="mt-4 text-center">For access, please contact the Free Joe Hunt team.</p>
      )}
      <p className="mt-4">
        <a href="https://github.com/anandaworldwide/mega-rag-chatbot" className="text-blue-400 hover:underline mx-2">
          Open Source Project
        </a>
      </p>

      {/* Feedback Button */}
      <FeedbackButton siteConfig={siteConfig} onClick={() => setShowFeedbackModal(true)} />

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <FeedbackModal isOpen={showFeedbackModal} onClose={() => setShowFeedbackModal(false)} siteConfig={siteConfig} />
      )}
    </div>
  );
}
