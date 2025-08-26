/**
 * Component for displaying user-friendly Firestore index error messages
 * Shows appropriate messaging for missing or building indexes
 */

import React from "react";

interface FirestoreIndexErrorProps {
  error?: string;
  isBuilding?: boolean;
  className?: string;
}

export function FirestoreIndexError({ error, isBuilding = false, className = "" }: FirestoreIndexErrorProps) {
  if (!error) return null;

  const iconClass = isBuilding ? "text-yellow-600" : "text-red-600";
  const bgClass = isBuilding ? "bg-yellow-50 border-yellow-200" : "bg-red-50 border-red-200";
  const textClass = isBuilding ? "text-yellow-800" : "text-red-800";

  return (
    <div className={`rounded-lg border p-4 ${bgClass} ${className}`}>
      <div className="flex items-start">
        <div className={`flex-shrink-0 ${iconClass}`}>
          {isBuilding ? (
            // Building/loading icon
            <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            // Error icon
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
        <div className="ml-3 flex-1">
          <h3 className={`text-sm font-medium ${textClass}`}>
            {isBuilding ? "Database Optimization in Progress" : "Database Configuration Required"}
          </h3>
          <div className={`mt-2 text-sm ${textClass}`}>
            <p>{error}</p>
            {isBuilding && (
              <p className="mt-2 text-xs opacity-75">
                This usually takes 5-15 minutes. You can try refreshing the page in a few minutes.
              </p>
            )}
          </div>
          {!isBuilding && (
            <div className="mt-3">
              <button
                onClick={() => window.location.reload()}
                className="rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to detect and handle Firestore index errors from API responses
 */
export function useFirestoreIndexError(error: any) {
  if (!error) return { isIndexError: false };

  const isIndexError =
    error?.type === "firestore_index_error" ||
    (typeof error === "string" &&
      (error.includes("query requires an index") ||
        error.includes("index is currently building") ||
        error.includes("database configuration") ||
        error.includes("database is currently being optimized")));

  const isBuilding = error?.isBuilding || (typeof error === "string" && error.includes("currently being optimized"));

  return {
    isIndexError,
    isBuilding,
    errorMessage: typeof error === "string" ? error : error?.error || error?.message,
  };
}
