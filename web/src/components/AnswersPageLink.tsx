import React, { useEffect, useState } from "react";
import Link from "next/link";
import { SiteConfig } from "@/types/siteConfig";

interface AnswersPageLinkProps {
  siteConfig: SiteConfig | null;
}

/**
 * Discrete link component that shows "View all answers"
 * at the bottom of pages for highest privilege users only.
 *
 * Shown to:
 * - Superusers on login-required sites
 * - Sudo users on no-login sites
 *
 * This component is intentionally subtle and only shown to privileged users
 * as a form of obfuscation - regular users won't see it.
 */
const AnswersPageLink: React.FC<AnswersPageLinkProps> = ({ siteConfig }) => {
  const [hasAccess, setHasAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkLinkVisibility = async () => {
      try {
        // Check if the discrete link should be shown for this user
        const response = await fetch("/api/answers/link-visibility", {
          method: "GET",
          credentials: "include", // Include cookies for authentication
        });

        if (response.ok) {
          const data = await response.json();
          setHasAccess(data.shouldShow);
        } else {
          setHasAccess(false);
        }
      } catch (error) {
        console.error("Error checking answers page link visibility:", error);
        setHasAccess(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkLinkVisibility();
  }, [siteConfig]);

  // Don't render anything while loading or if no access
  if (isLoading || !hasAccess) {
    return null;
  }

  return (
    <div className="mt-8 pt-4 border-t border-gray-200">
      <div className="text-center">
        <Link href="/answers" className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200">
          View all answers (admin only)
        </Link>
      </div>
    </div>
  );
};

export default AnswersPageLink;
