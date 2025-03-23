// Main application component for Next.js
import '@/styles/base.css';
import '@/styles/globals.css';
import 'react-toastify/dist/ReactToastify.css';
import type { AppProps, NextWebVitalsMetric } from 'next/app';
import { GoogleAnalytics, event } from 'nextjs-google-analytics';
import { Inter } from 'next/font/google';
import { ToastContainer, toast } from 'react-toastify';
import { AudioProvider } from '@/contexts/AudioContext';
import { SudoProvider } from '@/contexts/SudoContext';
import { SiteConfig } from '@/types/siteConfig';
import { getCommonSiteConfigProps } from '@/utils/server/getCommonSiteConfigProps';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/utils/client/reactQueryConfig';
import { initializeTokenManager } from '@/utils/client/tokenManager';
import { useEffect, useState } from 'react';

// Configure Inter font
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

// Extend AppProps to include custom pageProps
interface CustomAppProps extends AppProps {
  pageProps: {
    siteConfig: SiteConfig | null;
  };
}

// Main App component
function MyApp({ Component, pageProps }: CustomAppProps) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const [authInitialized, setAuthInitialized] = useState(false);

  // Initialize token manager when the app loads
  useEffect(() => {
    // Initialize the token manager immediately
    initializeTokenManager()
      .then(() => {
        setAuthInitialized(true);
        console.log('Authentication initialized successfully');
      })
      .catch((error) => {
        console.error('Failed to initialize token manager:', error);
        setAuthInitialized(false);
        // Show error toast on initialization failure
        toast.error(
          'Failed to initialize authentication. Some features may not work correctly.',
          {
            position: 'top-center',
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
          },
        );
        // We don't want to block rendering if this fails,
        // the token manager will retry when needed
      });
  }, []);

  // Listen for 401 errors globally
  useEffect(() => {
    // Custom error handler for 401 errors
    const handleAuthErrors = (event: any) => {
      // Check if this is a fetch error response with a 401 status
      if (
        event.detail &&
        event.detail.status === 401 &&
        authInitialized // Only show after initialization to avoid duplicate errors
      ) {
        toast.warning(
          'Authentication issue detected. Attempting to reconnect...',
          {
            position: 'top-center',
            autoClose: 3000,
            hideProgressBar: false,
          },
        );
      }
    };

    // Register global error event listener
    window.addEventListener('fetchError', handleAuthErrors);

    return () => {
      window.removeEventListener('fetchError', handleAuthErrors);
    };
  }, [authInitialized]);

  return (
    <QueryClientProvider client={queryClient}>
      <SudoProvider>
        <AudioProvider>
          <main className={inter.className}>
            {/* Only include Google Analytics in production */}
            {!isDevelopment && <GoogleAnalytics trackPageViews />}
            <Component {...pageProps} />
          </main>
          <ToastContainer />
        </AudioProvider>
      </SudoProvider>
    </QueryClientProvider>
  );
}

// Fetch initial props for the app
MyApp.getInitialProps = async () => {
  const result = await getCommonSiteConfigProps();
  return { pageProps: result.props };
};

// Function to report web vitals metrics
export function reportWebVitals(metric: NextWebVitalsMetric) {
  const { id, name, label, value } = metric;
  if (process.env.NODE_ENV === 'development') {
    console.log(
      'Not logging web vitals event in dev mode:',
      name,
      label,
      id,
      value,
    );
  } else {
    // Log web vitals event in production
    event(name, {
      category: label === 'web-vital' ? 'Web Vitals' : 'Next.js custom metric',
      value: Math.round(name === 'CLS' ? value * 1000 : value), // values must be integers
      label: id, // id unique to current page load
      nonInteraction: true, // avoids affecting bounce rate.
    });
  }
}

export default MyApp;
