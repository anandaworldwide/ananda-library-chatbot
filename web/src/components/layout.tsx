// Main layout component for the application
import { useEffect, useState } from "react";
import { SiteConfig } from "@/types/siteConfig";
import AnandaHeader from "./Header/AnandaHeader";
import AnandaPublicHeader from "./Header/AnandaPublicHeader";
import JairamHeader from "./Header/JairamHeader";
import CrystalHeader from "./Header/CrystalHeader";
import Footer from "./Footer";
import NPSSurvey from "./NPSSurvey";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSudo } from "@/contexts/SudoContext";
import Link from "next/link";

interface LayoutProps {
  children?: React.ReactNode;
  siteConfig: SiteConfig | null;
  useWideLayout?: boolean;
  onNewChat?: () => void;
}

export default function Layout({ children, siteConfig, useWideLayout = false, onNewChat }: LayoutProps) {
  const [isClient, setIsClient] = useState(false);
  const [, setVisitCount] = useLocalStorage("visitCount", 0);
  const { errorMessage } = useSudo();
  const [showErrorPopup, setShowErrorPopup] = useState(false);

  // Set isClient to true and increment visit count on component mount
  useEffect(() => {
    setIsClient(true);
    setVisitCount((prevCount: number) => prevCount + 1);
  }, [setVisitCount]);

  // Show error popup when errorMessage changes
  useEffect(() => {
    if (errorMessage) {
      setShowErrorPopup(true);
    }
  }, [errorMessage]);

  // Render the appropriate header based on siteConfig
  const renderHeader = () => {
    if (!siteConfig) return null;

    const headerProps = {
      siteConfig,
      constrainWidth: useWideLayout,
      onNewChat,
    };

    switch (siteConfig.siteId) {
      case "ananda":
        return <AnandaHeader {...headerProps} />;
      case "ananda-public":
        return <AnandaPublicHeader {...headerProps} />;
      case "jairam":
        return <JairamHeader {...headerProps} />;
      case "crystal":
        return <CrystalHeader {...headerProps} />;
      default:
        return null;
    }
  };

  // Prevent rendering until client-side
  if (!isClient) return null;

  return (
    <div className={`h-screen flex flex-col ${useWideLayout ? "w-full" : "app-container-wrap"}`}>
      <div
        className={`flex-grow flex flex-col ${useWideLayout ? "max-w-none w-full" : "max-w-[800px] mx-auto"} app-container`}
      >
        {renderHeader()}
        <div className="flex-grow overflow-auto main-content-wrap">
          <main className="flex flex-col h-full">{children}</main>
          {siteConfig && <NPSSurvey siteConfig={siteConfig} />}
        </div>
      </div>
      <Footer siteConfig={siteConfig} />
      {/* Error popup */}
      {showErrorPopup && errorMessage && (
        <div className="fixed bottom-4 right-4 bg-red-100 text-red-700 py-2 px-4 rounded-lg shadow-md flex items-center justify-between text-sm z-50 max-w-md">
          <div className="flex items-center">
            <p className="mr-4">{errorMessage}</p>
            {errorMessage === "Your IP has changed. Please re-authenticate." && (
              <Link href="/bless">
                <span className="underline cursor-pointer">Go to Bless page</span>
              </Link>
            )}
          </div>
          <button onClick={() => setShowErrorPopup(false)} className="text-red-700 hover:text-red-800 ml-4">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
