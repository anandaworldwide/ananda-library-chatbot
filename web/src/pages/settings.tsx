// Settings page: shows user email, liked answers, and a logout button
import React, { useEffect, useState } from "react";
import Head from "next/head";
import Layout from "@/components/layout";
import { getCommonSiteConfigProps } from "@/utils/server/getCommonSiteConfigProps";
import type { GetServerSideProps } from "next";
import type { SiteConfig } from "@/types/siteConfig";
import { fetchWithAuth } from "@/utils/client/tokenManager";

interface LikedAnswer {
  id: string;
  question: string;
  likeCount: number;
}

export default function SettingsPage({ siteConfig }: { siteConfig: SiteConfig | null }) {
  const [email, setEmail] = useState<string | null>(null);
  const [likedAnswers, setLikedAnswers] = useState<LikedAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Fetch a short-lived web token; if site does not require login, block access
        const tokenRes = await fetch("/api/web-token");
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData?.token) {
          setMessage("Settings are not available on this site");
          setLoading(false);
          return;
        }

        // Get user email from auth cookie by asking a lightweight endpoint that echoes decoded JWT
        // Reuse web-token’s signed token to call a small self endpoint (or decode on server). For now, read from /api/answers as a noop to validate session
        // Since we don’t have a dedicated profile endpoint yet, show placeholder email pulled from JWT is not available on client
        // Fallback: show "Signed in" without email
        try {
          const profileRes = await fetch("/api/profile");
          const profile = await profileRes.json().catch(() => ({}));
          if (profileRes.ok && profile?.email) {
            setEmail(profile.email);
          } else {
            setEmail(null);
          }
        } catch {
          setEmail(null);
        }

        // Fetch liked answers via existing APIs
        // 1) Get all liked answer IDs for current UUID
        const uuidCookie = document.cookie
          .split("; ")
          .find((c) => c.startsWith("uuid="))
          ?.split("=")[1];

        if (!uuidCookie) {
          setLikedAnswers([]);
          setLoading(false);
          return;
        }

        const likedIdsRes = await fetchWithAuth(`/api/like?uuid=${encodeURIComponent(uuidCookie)}`);
        const likedIds = (await likedIdsRes.json().catch(() => [])) as string[];

        if (Array.isArray(likedIds) && likedIds.length > 0) {
          const answersRes = await fetch(`/api/answers?answerIds=${encodeURIComponent(likedIds.join(","))}`);
          const answers = (await answersRes.json().catch(() => [])) as any[];
          const mapped: LikedAnswer[] = (answers || []).map((a: any) => ({
            id: a.id,
            question: a.question,
            likeCount: a.likeCount || 0,
          }));
          setLikedAnswers(mapped);
        } else {
          setLikedAnswers([]);
        }
      } catch (e: any) {
        setMessage(e?.message || "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleLogout(e: React.MouseEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/logout", { method: "POST" });
      if (!res.ok) throw new Error("Logout failed");
      window.location.href = "/";
    } catch (e: any) {
      setMessage(e?.message || "Logout failed");
    }
  }

  return (
    <>
      <Head>
        <title>Settings</title>
      </Head>
      <Layout siteConfig={siteConfig}>
        <main className="mx-auto max-w-3xl p-6 w-full">
          <h1 className="text-2xl font-semibold mb-4">Settings</h1>
          {message && <div className="mb-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">{message}</div>}

          {loading ? (
            <div>Loading…</div>
          ) : (
            <>
              <section className="mb-6">
                <h2 className="text-lg font-semibold mb-1">Account</h2>
                <div className="text-sm text-gray-700">{email ? `Email: ${email}` : "Signed in"}</div>
              </section>

              <section className="mb-6">
                <h2 className="text-lg font-semibold mb-2">Liked Answers</h2>
                {likedAnswers.length === 0 ? (
                  <div className="text-sm text-gray-600">No liked answers</div>
                ) : (
                  <ul className="list-disc pl-5 text-sm">
                    {likedAnswers.map((a) => (
                      <li key={a.id} className="mb-1">
                        <a href={`/answers/${a.id}`} className="text-blue-600 underline">
                          {a.question}
                        </a>
                        <span className="ml-2 text-gray-500">({a.likeCount} likes)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <button onClick={handleLogout} className="rounded bg-gray-800 px-3 py-1 text-white disabled:opacity-50">
                Logout
              </button>
            </>
          )}
        </main>
      </Layout>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  const props = await getCommonSiteConfigProps();
  return props as any;
};
