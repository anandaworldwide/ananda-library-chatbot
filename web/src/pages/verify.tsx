// Activation page: consumes token/email from query, calls /api/verifyMagicLink, sets session cookie
import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

export default function VerifyPage() {
  const router = useRouter();
  const { token, email } = router.query as { token?: string; email?: string };
  const [status, setStatus] = useState<"idle" | "activating" | "collecting" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  useEffect(() => {
    if (!token || !email || status !== "idle") return;
    setStatus("activating");
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
        setStatus("collecting");
        setMessage("");
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message || "Activation failed");
      }
    })();
  }, [token, email, status]);

  // After profile save, redirect to home after 2 seconds
  useEffect(() => {
    if (status !== "success") return;
    const t = setTimeout(() => {
      router.replace("/");
    }, 2000);
    return () => clearTimeout(t);
  }, [status, router]);

  async function onSubmitName(e: React.FormEvent) {
    e.preventDefault();
    try {
      setStatus("saving");
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save profile");
      setStatus("success");
      setMessage("Your account has been activated.");
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "Failed to save profile");
    }
  }

  return (
    <>
      <Head>
        <title>Verify Account</title>
      </Head>
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold mb-4">Account Verification</h1>
        {status === "idle" || status === "activating" ? (
          <div className="text-sm text-gray-700">Verifying your link…</div>
        ) : null}
        {status === "collecting" ? (
          <form onSubmit={onSubmitName} className="space-y-4">
            <p className="text-sm text-gray-700">Welcome! Please tell us your name.</p>
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
                required
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
                required
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            >
              Continue
            </button>
          </form>
        ) : null}
        {status === "saving" && <div>Saving your profile…</div>}
        {status === "success" ? (
          <div className="rounded border border-green-300 bg-green-50 p-3 text-sm mb-3">
            {message}
            <div className="mt-1">Redirecting to home…</div>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm mb-3">{message}</div>
        ) : null}
      </main>
    </>
  );
}
