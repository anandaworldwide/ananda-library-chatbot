// Activation page: consumes token/email from query, calls /api/verifyMagicLink, sets session cookie
import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

export default function VerifyPage() {
  const router = useRouter();
  const { token, email } = router.query as { token?: string; email?: string };
  const [status, setStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!token || !email || status !== "idle") return;
    setStatus("working");
    (async () => {
      try {
        const res = await fetch("/api/verifyMagicLink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token, email: decodeURIComponent(email) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Activation failed");
        setStatus("success");
        setMessage("Your account has been activated.");
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message || "Activation failed");
      }
    })();
  }, [token, email, status]);

  // After successful activation, inform user and redirect to home after 3 seconds
  useEffect(() => {
    if (status !== "success") return;
    const t = setTimeout(() => {
      router.replace("/");
    }, 3000);
    return () => clearTimeout(t);
  }, [status, router]);

  return (
    <>
      <Head>
        <title>Verify Account</title>
      </Head>
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold mb-4">Account Verification</h1>
        {status === "idle" || status === "working" ? (
          <div className="text-sm text-gray-700">Verifying your link…</div>
        ) : null}
        {status === "success" ? (
          <div className="rounded border border-green-300 bg-green-50 p-3 text-sm mb-3">
            {message}
            <div className="mt-1">Redirecting to home in three seconds.</div>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm mb-3">{message}</div>
        ) : null}
        <div className="mt-4">
          <a href="/" className="text-blue-600 underline">
            Go to Home
          </a>
        </div>
      </main>
    </>
  );
}
