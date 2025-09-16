/**
 * Chat conversation route - redirects to home page
 * This handles URLs like /chat/[convId] by redirecting to the home page
 * where the URL detection logic will load the conversation and set the title
 */

import { useRouter } from "next/router";
import { useEffect } from "react";
import { getCommonSiteConfigProps } from "@/utils/server/getCommonSiteConfigProps";

export default function ChatConversation() {
  const router = useRouter();

  useEffect(() => {
    // Immediate redirect to home page
    // The home page will detect the /chat/[convId] URL and load the conversation with proper title
    window.history.pushState(null, "", "/");
    router.push("/", router.asPath, { shallow: true });
  }, [router]);

  // Simple loading display (no title setting to avoid flashing)
  return (
    <div className="flex justify-center items-center h-screen">
      <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-600"></div>
      <p className="text-lg text-gray-600 ml-4">Loading conversation...</p>
    </div>
  );
}

// Fetch initial props for the page
ChatConversation.getInitialProps = async () => {
  const result = await getCommonSiteConfigProps();
  return result.props;
};
