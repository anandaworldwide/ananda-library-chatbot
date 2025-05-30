// Main layout component for the application
import { useEffect, useState } from 'react';
import { SiteConfig } from '@/types/siteConfig';
import AnandaHeader from './Header/AnandaHeader';
import AnandaPublicHeader from './Header/AnandaPublicHeader';
import JairamHeader from './Header/JairamHeader';
import CrystalHeader from './Header/CrystalHeader';
import Footer from './Footer';
import NPSSurvey from './NPSSurvey';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useSudo } from '@/contexts/SudoContext';
import Link from 'next/link';

interface LayoutProps {
  children?: React.ReactNode;
  siteConfig: SiteConfig | null;
}

export default function Layout({ children, siteConfig }: LayoutProps) {
  const [isClient, setIsClient] = useState(false);
  const [, setVisitCount] = useLocalStorage('visitCount', 0);
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

    switch (siteConfig.siteId) {
      case 'ananda':
        return <AnandaHeader siteConfig={siteConfig} />;
      case 'ananda-public':
        return <AnandaPublicHeader siteConfig={siteConfig} />;
      case 'jairam':
        return <JairamHeader siteConfig={siteConfig} />;
      case 'crystal':
        return <CrystalHeader siteConfig={siteConfig} />;
      default:
        return null;
    }
  };

  // Prevent rendering until client-side
  if (!isClient) return null;

  return (
    <div className="h-screen flex flex-col app-container-wrap">
      <div className="flex-grow mx-auto flex flex-col max-w-[800px] app-container">
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
            {errorMessage ===
              'Your IP has changed. Please re-authenticate.' && (
              <Link href="/bless">
                <span className="underline cursor-pointer">
                  Go to Bless page
                </span>
              </Link>
            )}
          </div>
          <button
            onClick={() => setShowErrorPopup(false)}
            className="text-red-700 hover:text-red-800 ml-4"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
