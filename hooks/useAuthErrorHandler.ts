import { useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useRouter } from 'next/router';
import { initializeTokenManager } from '@/utils/client/tokenManager';

/**
 * Custom hook for handling authentication errors consistently across the application.
 *
 * This hook:
 * 1. Sets up listeners for authentication errors
 * 2. Provides functions to handle session expiration
 * 3. Manages recovery attempts
 *
 * @param onSessionExpired Optional callback when a session has expired and recovery failed
 * @returns Object containing utility functions for auth error handling
 */
export function useAuthErrorHandler(onSessionExpired?: () => void) {
  const router = useRouter();

  /**
   * Handle authentication errors from API calls
   */
  const handleAuthError = useCallback(
    async (url: string, maxRetries = 1) => {
      console.log(
        `Handling auth error for ${url}, with ${maxRetries} retries allowed`,
      );

      let retryCount = 0;
      let success = false;

      // Attempt to refresh the token
      while (retryCount < maxRetries && !success) {
        try {
          // Only show message on first attempt
          if (retryCount === 0) {
            toast.info('Attempting to restore your session...', {
              autoClose: 2000,
            });
          }

          // Force token refresh
          await initializeTokenManager();
          success = true;

          toast.success('Session restored!', {
            autoClose: 2000,
          });
        } catch (error) {
          console.error('Failed to refresh token:', error);
          retryCount++;

          // If we've failed all retries, show an error
          if (retryCount >= maxRetries) {
            toast.error('Your session has expired. Please log in again.', {
              autoClose: 5000,
            });

            // Call the optional callback
            if (onSessionExpired) {
              onSessionExpired();
            }

            // Consider redirecting to login page
            if (url !== '/api/web-token' && url !== '/login') {
              // Ensure we're not already on the login page to avoid refresh loops
              if (
                typeof window !== 'undefined' &&
                window.location.pathname !== '/login'
              ) {
                // Add a small delay to allow the toast to be seen
                setTimeout(() => {
                  // Clear any error events/UI before redirecting
                  window.dispatchEvent(new CustomEvent('clearAuthErrors', {}));
                  router.push('/login');
                }, 1500);
              }
            }
          }
        }
      }

      return success;
    },
    [router, onSessionExpired],
  );

  // Set up global listeners for authentication errors
  useEffect(() => {
    const handleFetchError = (
      event: CustomEvent<{
        url: string;
        status: number;
        statusText: string;
        method: string;
      }>,
    ) => {
      // Only handle authentication errors (401)
      if (event.detail.status === 401) {
        console.log(
          'Auth error intercepted by useAuthErrorHandler:',
          event.detail,
        );
        handleAuthError(event.detail.url);
      }
    };

    // Handler to clear any error state if needed
    const handleClearAuthErrors = () => {
      console.log('Clearing auth error states');
      // This event can be used by components to clear their error states
    };

    // Add event listeners
    window.addEventListener('fetchError', handleFetchError as EventListener);
    window.addEventListener(
      'clearAuthErrors',
      handleClearAuthErrors as EventListener,
    );

    // Clean up
    return () => {
      window.removeEventListener(
        'fetchError',
        handleFetchError as EventListener,
      );
      window.removeEventListener(
        'clearAuthErrors',
        handleClearAuthErrors as EventListener,
      );
    };
  }, [router, handleAuthError]);

  /**
   * Force logout and redirect to login page
   */
  const handleForceLogout = useCallback(() => {
    // Make logout API call
    fetch('/api/logout', {
      method: 'POST',
      credentials: 'include',
    })
      .then(() => {
        toast.info('You have been logged out.', {
          autoClose: 3000,
        });

        // Redirect to login page
        router.push('/login');
      })
      .catch((error) => {
        console.error('Logout failed:', error);
        // Still redirect even if the API call fails
        router.push('/login');
      });
  }, [router]);

  /**
   * Attempt to recover from an expired session
   */
  const attemptSessionRecovery = useCallback(async (): Promise<boolean> => {
    try {
      // Force token refresh
      await initializeTokenManager();
      return true;
    } catch (error) {
      console.error('Session recovery failed:', error);
      return false;
    }
  }, []);

  return {
    handleAuthError,
    handleForceLogout,
    attemptSessionRecovery,
  };
}
