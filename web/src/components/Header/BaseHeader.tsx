import Link from "next/link";
import { useRouter } from "next/router";
import Cookies from "js-cookie";
import { useState, useEffect } from "react";
import { logEvent } from "@/utils/client/analytics";
import { HeaderConfig } from "@/types/siteConfig";
import { isDevelopment } from "@/utils/env";
import { fetchWithAuth, initializeTokenManager, isAuthenticated } from "@/utils/client/tokenManager";

interface BaseHeaderProps {
  config: HeaderConfig;
  parentSiteUrl?: string;
  parentSiteName?: string;
  className?: string;
  logoComponent?: React.ReactNode;
  requireLogin: boolean;
}

export default function BaseHeader({
  config,
  parentSiteUrl,
  parentSiteName,
  logoComponent,
  requireLogin,
}: BaseHeaderProps) {
  const router = useRouter();
  // Fast initial state from non-HttpOnly cookie to avoid flicker; will be reconciled after init
  const [isLoggedIn, setIsLoggedIn] = useState(() => Cookies.get("isLoggedIn") === "true");
  const [authReady, setAuthReady] = useState(false);
  const isActive = (pathname: string) => router.pathname === pathname;

  // Keep auth state in sync without extra network calls
  useEffect(() => {
    // Trigger (deduped) auth initialization so we can reflect JWT state
    initializeTokenManager()
      .then(() => {
        setIsLoggedIn(isAuthenticated() || Cookies.get("isLoggedIn") === "true");
        setAuthReady(true);
      })
      .catch(() => {
        setAuthReady(true);
      });

    const handleRoute = () => setIsLoggedIn(isAuthenticated() || Cookies.get("isLoggedIn") === "true");
    router.events.on("routeChangeComplete", handleRoute);
    return () => {
      router.events.off("routeChangeComplete", handleRoute);
    };
  }, [router.events]);

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await fetchWithAuth("/api/logout", { method: "POST" });
    // Clear both legacy and new authentication cookies
    Cookies.remove("siteAuth", { path: "/" });
    Cookies.remove("auth", { path: "/" });
    Cookies.remove("isLoggedIn", { path: "/" });
    setIsLoggedIn(false);
    router.push("/");
  };

  const handleBackToLibrary = () => {
    logEvent("click_back_to_library", "Navigation", "");
  };

  return (
    <header className="sticky top-0 z-40 bg-white w-full">
      {isDevelopment() && (
        <div className="bg-blue-500 text-white text-center py-1 w-full">Dev server (site: {process.env.SITE_ID})</div>
      )}
      <div className="h-16 border-b border-b-slate-200 py-4 flex justify-between items-center px-4">
        <div className="flex items-center">
          {logoComponent ? <Link href="/">{logoComponent}</Link> : null}
          <nav className={`${logoComponent ? "ml-2 pl-1" : ""}`}>
            <div className="space-x-10">
              {parentSiteUrl && (
                <Link
                  href={parentSiteUrl}
                  className="text-sm text-gray-500 hover:text-slate-600 cursor-pointer"
                  onClick={handleBackToLibrary}
                >
                  ← {parentSiteName}
                </Link>
              )}
              {config.navItems.map((item) => (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`hover:text-slate-600 cursor-pointer ${
                    isActive(item.path) ? "text-slate-800 font-bold" : ""
                  }`}
                >
                  <span dangerouslySetInnerHTML={{ __html: item.label }} />
                </Link>
              ))}
            </div>
          </nav>
        </div>
        {requireLogin && authReady && (
          <nav className="mr-4 pr-6 flex space-x-4">
            {isLoggedIn ? (
              <a href="#" onClick={handleLogout} className="text-sm text-gray-500 hover:text-slate-600 cursor-pointer">
                Logout
              </a>
            ) : (
              <Link href="/login" className="text-sm text-gray-500 hover:text-slate-600 cursor-pointer">
                Login
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
