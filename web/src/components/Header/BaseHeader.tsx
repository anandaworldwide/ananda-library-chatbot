import Link from "next/link";
import { useRouter } from "next/router";
import Cookies from "js-cookie";
import { useState, useEffect } from "react";
import { logEvent } from "@/utils/client/analytics";
import { HeaderConfig } from "@/types/siteConfig";
import { isDevelopment } from "@/utils/env";
import { initializeTokenManager, isAuthenticated } from "@/utils/client/tokenManager";

interface BaseHeaderProps {
  config: HeaderConfig;
  parentSiteUrl?: string;
  parentSiteName?: string;
  className?: string;
  logoComponent?: React.ReactNode;
  requireLogin: boolean;
  constrainWidth?: boolean;
  onNewChat?: () => void;
}

export default function BaseHeader({
  config,
  parentSiteUrl,
  parentSiteName,
  logoComponent,
  requireLogin,
  constrainWidth = false,
  onNewChat,
}: BaseHeaderProps) {
  const router = useRouter();
  // Fast initial state from non-HttpOnly cookie to avoid flicker; will be reconciled after init
  const [isLoggedIn, setIsLoggedIn] = useState(() => Cookies.get("isLoggedIn") === "true");
  const [authReady, setAuthReady] = useState(false);
  const isActive = (pathname: string) => router.pathname === pathname;

  // Keep auth state in sync without extra network calls
  useEffect(() => {
    const updateAuthState = () => {
      const cookieLoggedIn = Cookies.get("isLoggedIn") === "true";
      const tokenAuthenticated = isAuthenticated();
      setIsLoggedIn(tokenAuthenticated || cookieLoggedIn);
    };

    // Trigger (deduped) auth initialization so we can reflect JWT state
    initializeTokenManager()
      .then(() => {
        updateAuthState();
        setAuthReady(true);
      })
      .catch(() => {
        // Even if token initialization fails, check cookie state
        updateAuthState();
        setAuthReady(true);
      });

    const handleRoute = () => updateAuthState();
    router.events.on("routeChangeComplete", handleRoute);

    // Also listen for focus events to catch auth state changes when user returns to tab
    const handleFocus = () => updateAuthState();
    window.addEventListener("focus", handleFocus);

    return () => {
      router.events.off("routeChangeComplete", handleRoute);
      window.removeEventListener("focus", handleFocus);
    };
  }, [router.events]);

  const handleBackToLibrary = () => {
    logEvent("click_back_to_library", "Navigation", "");
  };

  return (
    <header className="sticky top-0 z-40 bg-white w-full">
      {isDevelopment() && (
        <div className="bg-blue-500 text-white text-center py-1 w-full">Dev server (site: {process.env.SITE_ID})</div>
      )}
      <div
        className={`h-16 border-b border-b-slate-200 py-4 ${constrainWidth ? "lg:grid lg:grid-cols-[288px_1fr] lg:px-0" : "px-4"}`}
      >
        {constrainWidth && <div className="hidden lg:block"></div>}
        <div className={`flex justify-between items-center ${constrainWidth ? "mx-auto w-full max-w-4xl px-4" : ""}`}>
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
          <div className="flex items-center space-x-4">
            {onNewChat && (
              <button
                onClick={onNewChat}
                aria-label="New Chat"
                className="text-gray-600 hover:text-slate-800 p-1 rounded-md hover:bg-gray-100 transition-colors"
                title="Start New Chat"
              >
                <span className="material-icons text-xl">edit</span>
              </button>
            )}
            {requireLogin && authReady && (
              <nav className="mr-4 pr-6 flex space-x-4">
                {isLoggedIn ? (
                  <Link href="/settings" aria-label="User settings" className="text-gray-600 hover:text-slate-800">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                      <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5zm0 2c-3.866 0-7 3.134-7 7h2a5 5 0 0 1 10 0h2c0-3.866-3.134-7-7-7z" />
                    </svg>
                  </Link>
                ) : (
                  <Link href="/login" className="text-sm text-gray-500 hover:text-slate-600 cursor-pointer">
                    Login
                  </Link>
                )}
              </nav>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
