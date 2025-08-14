import { useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/router";
import { SiteConfig } from "@/types/siteConfig";
import { isPublicPage } from "@/utils/client/authConfig";

interface AuthGuardProps {
  children: ReactNode;
  siteConfig: SiteConfig | null;
}

/**
 * AuthGuard component that prevents content from rendering until authentication
 * status is determined. This prevents the flash of content before redirect to login.
 */
export default function AuthGuard({ children, siteConfig }: AuthGuardProps) {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      // Set up loading timer - show loading spinner after 2 seconds
      const loadingTimer = setTimeout(() => {
        setShowLoading(true);
      }, 2000);

      // Check if current page is public
      const currentPath = router.asPath.split("?")[0]; // Remove query params for page check
      const isPagePublic = isPublicPage(currentPath, siteConfig);

      // If page is public, no auth check needed
      if (isPagePublic) {
        clearTimeout(loadingTimer);
        setIsAuthenticated(true);
        setAuthChecked(true);
        return;
      }

      // If site doesn't require login, allow access
      if (siteConfig && !siteConfig.requireLogin) {
        clearTimeout(loadingTimer);
        setIsAuthenticated(true);
        setAuthChecked(true);
        return;
      }

      // For protected pages, check authentication by calling the web-token endpoint directly
      try {
        const response = await fetch("/api/web-token", {
          headers: {
            Referer: window.location.href,
          },
        });

        if (response.ok) {
          // User is authenticated
          clearTimeout(loadingTimer);
          setIsAuthenticated(true);
          setAuthChecked(true);
        } else if (response.status === 401) {
          // User is not authenticated - redirect to login immediately
          clearTimeout(loadingTimer);
          console.log("User not authenticated, redirecting to login");

          // Save current full path (path + search) for redirect after login
          const fullPath = router.asPath;
          const redirectUrl = `/login?redirect=${encodeURIComponent(fullPath)}`;

          // Use router.replace to avoid adding to browser history
          router.replace(redirectUrl);

          // Keep showing loading state during redirect
          setIsAuthenticated(false);
          // Don't set authChecked to true - this prevents content flash
        } else {
          // Other error - treat as unauthenticated
          clearTimeout(loadingTimer);
          console.error("Authentication check failed:", response.status);
          setIsAuthenticated(false);
          setAuthChecked(true);
        }
      } catch (error) {
        // Network error - treat as unauthenticated
        clearTimeout(loadingTimer);
        console.error("Authentication check error:", error);
        setIsAuthenticated(false);
        setAuthChecked(true);
      }
    };

    // Only run auth check if we have router ready and siteConfig
    if (router.isReady && siteConfig !== null) {
      checkAuth();
    }
  }, [router, siteConfig]);

  // Show loading spinner only after 2 seconds if still checking authentication
  if (!authChecked && showLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If auth not checked yet but we're not showing loading, render nothing (blank)
  if (!authChecked) {
    return null;
  }

  // Only render children if authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
