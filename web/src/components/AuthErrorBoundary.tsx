import React, { Component, ErrorInfo, ReactNode } from 'react';
import { toast } from 'react-toastify';
import Link from 'next/link';
import { initializeTokenManager } from '@/utils/client/tokenManager';

interface AuthErrorBoundaryProps {
  children: ReactNode;
}

interface AuthErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isSessionExpired: boolean;
}

/**
 * AuthErrorBoundary provides a consistent way to handle authentication-related errors
 * across the application. It catches rendering errors that might be caused by
 * authentication issues and provides a fallback UI with recovery options.
 */
class AuthErrorBoundary extends Component<
  AuthErrorBoundaryProps,
  AuthErrorBoundaryState
> {
  constructor(props: AuthErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isSessionExpired: false,
    };
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<AuthErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      isSessionExpired:
        error.message.includes('unauthorized') ||
        error.message.includes('authentication') ||
        error.message.includes('401') ||
        error.message.includes('token'),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error to an error reporting service
    console.error(
      'Authentication Error Boundary caught an error:',
      error,
      errorInfo,
    );

    this.setState({
      errorInfo,
    });
  }

  /**
   * Attempts to recover from authentication errors by
   * refreshing the token and resetting the error state
   */
  handleRecoveryAttempt = async (): Promise<void> => {
    try {
      // Show loading toast
      toast.info('Attempting to restore your session...', {
        autoClose: 2000,
      });

      // Force token refresh
      await initializeTokenManager();

      // Reset error state to trigger a re-render of children
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        isSessionExpired: false,
      });

      toast.success('Session restored successfully!', {
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Recovery attempt failed:', error);
      toast.error(
        'Could not restore your session. Please try logging in again.',
        {
          autoClose: 5000,
        },
      );
    }
  };

  /**
   * Handles a page refresh to attempt recovery
   */
  handleRefresh = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  /**
   * Handle navigation to login page and reset error state
   */
  handleGoToLogin = (): void => {
    // Reset error state before navigation
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isSessionExpired: false,
    });

    // Navigation will happen via the Link component
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Render fallback UI for authentication errors
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
          <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-md">
            <div className="flex items-center justify-center mb-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-16 h-16 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-4h1m-1-1V8m-2 6h3m2-2v4m-2-2h2m0 0h2m-4 0h4m-6-4v2m0 0v2m0-2h2m-2 0H7"
                />
              </svg>
            </div>

            <h2 className="mb-4 text-xl font-bold text-center text-gray-800">
              {this.state.isSessionExpired
                ? 'Your session has expired'
                : 'Something went wrong'}
            </h2>

            <p className="mb-6 text-gray-600 text-center">
              {this.state.isSessionExpired
                ? 'Your authentication session has expired or is invalid. Please restore your session to continue.'
                : 'We encountered an unexpected error. Please try again.'}
            </p>

            <div className="flex flex-col space-y-3">
              <button
                onClick={this.handleRecoveryAttempt}
                className="w-full px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
              >
                Restore Session
              </button>

              <button
                onClick={this.handleRefresh}
                className="w-full px-4 py-2 text-blue-600 bg-white border border-blue-600 rounded hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
              >
                Refresh Page
              </button>

              <Link href="/login" passHref>
                <button
                  onClick={this.handleGoToLogin}
                  className="w-full px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50"
                >
                  Go to Login
                </button>
              </Link>
            </div>

            {/* Show more details if in development environment */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-6 p-4 bg-gray-100 rounded text-sm overflow-auto">
                <p className="font-mono text-red-600">
                  {this.state.error.toString()}
                </p>
                {this.state.errorInfo && (
                  <pre className="mt-2 font-mono text-xs text-gray-700">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Render children if no error
    return this.props.children;
  }
}

export default AuthErrorBoundary;
