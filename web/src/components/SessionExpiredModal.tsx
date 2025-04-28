import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { initializeTokenManager } from '@/utils/client/tokenManager';

interface SessionExpiredModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * SessionExpiredModal is displayed when the user's session has expired.
 * It offers options to restore the session or navigate to the login page.
 */
const SessionExpiredModal: React.FC<SessionExpiredModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  // Don't render anything if the modal is not open
  if (!isOpen) return null;

  /**
   * Attempt to restore the user's session by refreshing the token
   */
  const handleRestoreSession = async () => {
    setIsLoading(true);
    try {
      // Attempt to get a new token
      await initializeTokenManager();

      toast.success('Session restored successfully!', {
        position: 'top-center',
        autoClose: 3000,
      });

      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }

      // Close the modal
      onClose();
    } catch (error) {
      console.error('Failed to restore session:', error);
      toast.error('Could not restore your session. Please log in again.', {
        position: 'top-center',
        autoClose: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Navigate to the login page and close the modal
   */
  const handleGoToLogin = () => {
    // Close the modal first
    onClose();
    // Then navigate
    router.push('/login');
  };

  return (
    // Modal overlay
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      {/* Modal content */}
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 overflow-hidden">
        {/* Modal header */}
        <div className="bg-red-50 px-6 py-4 border-b border-red-100">
          <div className="flex items-center justify-center">
            <div className="bg-red-100 rounded-full p-2 mr-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-red-800">
              Session Expired
            </h3>
          </div>
        </div>

        {/* Modal body */}
        <div className="px-6 py-4">
          <p className="text-gray-700 mb-4">
            Your authentication session has expired. You need to restore your
            session to continue using the application.
          </p>
          <p className="text-sm text-gray-500 mb-4">
            This happens automatically after a period of inactivity to protect
            your security.
          </p>
        </div>

        {/* Modal footer */}
        <div className="px-6 py-4 bg-gray-50 flex flex-col sm:flex-row sm:justify-end space-y-2 sm:space-y-0 sm:space-x-2">
          <button
            onClick={handleGoToLogin}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
          >
            Go to Login
          </button>
          <button
            onClick={handleRestoreSession}
            disabled={isLoading}
            className={`px-4 py-2 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
              isLoading
                ? 'bg-blue-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Restoring...
              </span>
            ) : (
              'Restore Session'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionExpiredModal;
