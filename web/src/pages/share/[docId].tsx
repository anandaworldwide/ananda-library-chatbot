/**
 * Share conversation route - redirects to home page
 * This handles URLs like /share/[docId] by redirecting to the home page
 * where the URL detection logic will load the shared conversation
 */

import { useRouter } from "next/router";
import { useEffect } from "react";

export default function ShareConversation() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home page, preserving the URL path
    // The home page will detect the /share/[docId] URL and load the conversation
    router.replace("/", router.asPath, { shallow: false });
  }, [router]);

  // Show loading while redirecting
  return (
    <div className="flex justify-center items-center h-screen">
      <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-600"></div>
      <p className="text-lg text-gray-600 ml-4">Loading shared conversation...</p>
    </div>
  );
}
