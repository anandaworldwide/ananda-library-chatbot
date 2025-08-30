/**
 * This component uses React Query for data fetching with JWT authentication while preserving
 * scroll position preservation and optimistic updates.
 *
 * Key features:
 * - Pagination with server-side rendering
 * - Answers sorted by most recent
 * - Copy link to individual answers
 * - Delete answers (for sudo users only)
 * - Scroll position preservation
 * - JWT authentication with React Query
 * - Admin-only access control
 */

import Layout from "@/components/layout";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/router";
import { logEvent } from "@/utils/client/analytics";
import React from "react";
import { GetServerSideProps } from "next";
import AnswerItem from "@/components/AnswerItem";
import { SiteConfig } from "@/types/siteConfig";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { NextApiRequest, NextApiResponse } from "next";
import { useSudo } from "@/contexts/SudoContext";
import { SudoProvider } from "@/contexts/SudoContext";
import { useAnswers } from "@/hooks/useAnswers";
import { useMutation } from "@tanstack/react-query";
import { queryFetch } from "@/utils/client/reactQueryConfig";
import { isAnswersPageAllowed, getAnswersPageErrorMessage } from "@/utils/server/answersPageAuth";

interface AllAnswersProps {
  siteConfig: SiteConfig | null;
  authorizationError?: boolean;
  errorMessage?: string;
}

const AllAnswers = ({ siteConfig, authorizationError, errorMessage }: AllAnswersProps) => {
  const router = useRouter();
  const { isSudoUser, checkSudoStatus } = useSudo();
  const [isAdmin, setIsAdmin] = useState(false);

  // Parse query parameters
  const urlPage = router.query.page ? Number(router.query.page) : 1;

  // UI state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isPageInitialized, setIsPageInitialized] = useState(false);
  const [isChangingPage, setIsChangingPage] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [isRestoringScroll, setIsRestoringScroll] = useState(false);
  const [linkCopied, setLinkCopied] = useState<string | null>(null);

  // Refs for scroll management
  const scrollPositionRef = useRef<number>(0);
  const hasInitiallyFetched = useRef(false);

  // State for delayed spinner
  const [showDelayedSpinner, setShowDelayedSpinner] = useState(false);
  const [showExtendedLoadingMessage, setShowExtendedLoadingMessage] = useState(false);

  // Check admin status for login-required sites
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (siteConfig?.requireLogin) {
        try {
          const response = await queryFetch("/api/profile");
          if (response.ok) {
            const data = await response.json();
            const role = data.role?.toLowerCase();
            setIsAdmin(role === "admin" || role === "superuser");
          } else {
            setIsAdmin(false);
          }
        } catch (error) {
          console.error("Failed to check admin status:", error);
          setIsAdmin(false);
        }
      } else {
        // For no-login sites, use sudo status
        setIsAdmin(isSudoUser);
      }
    };
    checkAdminStatus();
  }, [siteConfig?.requireLogin, isSudoUser]);

  // Use React Query for data fetching with JWT authentication
  const { data, isLoading, error } = useAnswers(currentPage, {
    enabled: isPageInitialized && router.isReady,
  });

  // Show delayed spinner for long-running loads
  useEffect(() => {
    // Set a timeout to show the spinner after 1.5 seconds
    const spinner = setTimeout(() => {
      if (isLoading) {
        setShowDelayedSpinner(true);
      }
    }, 1500);

    // Set a timeout to show extended loading message after 8 seconds
    const extended = setTimeout(() => {
      if (isLoading) {
        setShowExtendedLoadingMessage(true);
      }
    }, 8000);

    // Clear the timeout if the component unmounts or isLoading changes to false
    return () => {
      clearTimeout(spinner);
      clearTimeout(extended);
    };
  }, [isLoading]);

  // Set initial load state when data is loaded
  useEffect(() => {
    if (data && !hasInitiallyFetched.current) {
      hasInitiallyFetched.current = true;
      setInitialLoadComplete(true);
      setIsRestoringScroll(true);

      // Reset changing page state if needed
      if (isChangingPage) {
        setIsChangingPage(false);
      }
    }
  }, [data, isChangingPage]);

  // Extract data from query result
  const answersData = useMemo(() => data?.answers || [], [data?.answers]);
  const totalPages = useMemo(() => data?.totalPages || 1, [data?.totalPages]);

  // Delete mutation with React Query
  const deleteMutation = useMutation({
    mutationFn: async (answerId: string) => {
      const response = await queryFetch(`/api/answers?answerId=${answerId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const responseData = await response.json();
        throw new Error("Failed to delete answer (" + responseData.message + ")");
      }
      return response.json();
    },
    onSuccess: (data, answerId) => {
      logEvent("delete_answer", "Admin", answerId);
    },
    onError: (error) => {
      console.error("Error deleting answer:", error);
      alert("Failed to delete answer. Please try again.");
    },
  });

  // Scroll position management functions
  const saveScrollPosition = () => {
    const scrollY = window.scrollY;
    if (scrollY > 0) {
      sessionStorage.setItem("answersScrollPosition", scrollY.toString());
    }
  };

  const getSavedScrollPosition = () => {
    const savedPosition = sessionStorage.getItem("answersScrollPosition");
    return savedPosition ? parseInt(savedPosition, 10) : 0;
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "auto",
    });
    // Force a reflow to ensure the scroll is applied immediately
    void document.body.offsetHeight;
  };

  // Save scroll position periodically
  useEffect(() => {
    const intervalId = setInterval(saveScrollPosition, 1000);
    return () => clearInterval(intervalId);
  }, []);

  // Save scroll position before unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveScrollPosition();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // Handle popstate event for browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setIsRestoringScroll(true);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Restore scroll position when navigating back
  useEffect(() => {
    if (isRestoringScroll && !isLoading && initialLoadComplete) {
      const savedPosition = getSavedScrollPosition();
      setTimeout(() => {
        window.scrollTo({
          top: savedPosition,
          behavior: "auto",
        });
        setIsRestoringScroll(false);
        sessionStorage.removeItem("answersScrollPosition");
      }, 100);
    }
  }, [isRestoringScroll, isLoading, initialLoadComplete]);

  // Initialize based on URL parameters
  useEffect(() => {
    if (router.isReady) {
      const pageFromUrl = Number(urlPage) || 1;

      setCurrentPage(pageFromUrl);
      setIsPageInitialized(true);
    }
  }, [router.isReady, urlPage]);

  // Update URL with current page
  const updateUrl = useCallback(
    (page: number) => {
      if (router.isReady) {
        let path = "/answers";
        const params = new URLSearchParams();

        if (page !== 1) {
          params.append("page", page.toString());
        }

        if (params.toString()) {
          path += "?" + params.toString();
        }

        // Use router.push() to create browser history entries for back button navigation
        router.push(
          {
            pathname: "/answers",
            query: page !== 1 ? { page: page.toString() } : {},
          },
          path,
          { shallow: true }
        );
      }
    },
    [router]
  );

  // Handle answer deletion (for sudo users only)
  const handleDelete = (answerId: string) => {
    if (confirm("Are you sure you want to delete this answer?")) {
      deleteMutation.mutate(answerId);
    }
  };

  // Handle copying answer link
  const handleCopyLink = (answerId: string) => {
    const url = `${window.location.origin}/share/${answerId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(answerId);
      setTimeout(() => setLinkCopied(null), 2000);
      logEvent("copy_link", "Engagement", `Answer ID: ${answerId}`);
    });
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    if (newPage === currentPage) return;

    scrollToTop();
    setIsChangingPage(true);
    setCurrentPage(newPage);
    sessionStorage.removeItem("answersScrollPosition");
    updateUrl(newPage);
    logEvent("change_answers_page", "UI", `page:${newPage}`);

    // React Query will handle the data fetching when currentPage changes
    // We just need to reset some UI state
    setInitialLoadComplete(false);
    hasInitiallyFetched.current = false;

    // Save current scroll position
    scrollPositionRef.current = 0;
  };

  // Check sudo status on component mount
  useEffect(() => {
    if (!(siteConfig && siteConfig.requireLogin)) {
      checkSudoStatus();
    }
  }, [checkSudoStatus, siteConfig]);

  return (
    <SudoProvider disableChecks={!!siteConfig && !!siteConfig.requireLogin}>
      <Layout siteConfig={siteConfig}>
        {/* Authorization error display */}
        {authorizationError && (
          <div className="mx-auto max-w-full sm:max-w-4xl px-2 sm:px-6 lg:px-8">
            <div className="flex flex-col justify-center items-center min-h-screen">
              <div className="text-center">
                <h1 className="text-6xl font-bold text-gray-400 mb-4">403</h1>
                <h2 className="text-2xl font-semibold text-gray-800 mb-4">{errorMessage || "Access Restricted"}</h2>
                <p className="text-gray-600 mb-8 max-w-md">
                  You don't have permission to access this page. This page is restricted to authorized users only.
                </p>
                <button
                  onClick={() => router.push("/")}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Go to Chat
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main content - only show if no authorization error */}
        {!authorizationError && (
          <>
            <div className="mx-auto max-w-full sm:max-w-4xl px-2 sm:px-6 lg:px-8">
              {/* Loading spinner */}
              {(isLoading && !initialLoadComplete) || isChangingPage ? (
                <div className="flex flex-col justify-center items-center h-screen">
                  <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-600"></div>
                  <p className="text-lg text-gray-600 mt-4">
                    {showExtendedLoadingMessage
                      ? "Still loading... This is taking longer than expected."
                      : showDelayedSpinner
                        ? "Still loading..."
                        : "Loading..."}
                  </p>
                  {showExtendedLoadingMessage && (
                    <p className="text-sm text-gray-500 mt-2 max-w-md text-center">
                      We were unable to load the content. You can try refreshing the page if this continues.
                    </p>
                  )}

                  {showExtendedLoadingMessage && (
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Refresh Page
                    </button>
                  )}
                </div>
              ) : (
                <div key={`${currentPage}-mostRecent`}>
                  {/* Error state */}
                  {error && (
                    <div className="text-red-500 text-center my-6">
                      {error instanceof Error ? error.message : "Error loading answers"}
                    </div>
                  )}

                  {/* Top pagination controls */}
                  {answersData.length > 0 && (
                    <div className="flex justify-center mb-6">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1 || isChangingPage}
                        className="px-4 py-2 mr-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
                      >
                        Previous
                      </button>
                      <span className="px-4 py-2">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages || isChangingPage}
                        className="px-4 py-2 ml-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
                      >
                        Next
                      </button>
                    </div>
                  )}

                  {/* List of answers */}
                  <div>
                    {answersData.map((answer) => (
                      <AnswerItem
                        key={answer.id}
                        answer={answer}
                        siteConfig={siteConfig}
                        handleCopyLink={handleCopyLink}
                        handleDelete={isAdmin ? handleDelete : undefined}
                        linkCopied={linkCopied}
                        isSudoUser={isAdmin}
                        isFullPage={false}
                      />
                    ))}
                  </div>

                  {/* Empty state */}
                  {answersData.length === 0 && !isLoading && !error && (
                    <div className="text-center py-8">
                      <p>No answers found.</p>
                    </div>
                  )}

                  {/* Bottom pagination controls */}
                  {answersData.length > 0 && (
                    <div className="flex justify-center mt-6">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1 || isChangingPage}
                        className="px-4 py-2 mr-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
                      >
                        Previous
                      </button>
                      <span className="px-4 py-2">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages || isChangingPage}
                        className="px-4 py-2 ml-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error messages */}
            {deleteMutation.isError && (
              <div className="text-red-500 text-sm mt-2 text-center">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete answer"}
              </div>
            )}
          </>
        )}
      </Layout>
    </SudoProvider>
  );
};

// Server-side props to load site configuration and check permissions
export const getServerSideProps: GetServerSideProps = async (context) => {
  const siteId = process.env.SITE_ID || "default";
  const siteConfig = await loadSiteConfig(siteId);

  if (!siteConfig) {
    return {
      notFound: true,
    };
  }

  // Check if user is allowed to access the answers page
  const req = context.req as unknown as NextApiRequest;
  const res = context.res as unknown as NextApiResponse;

  const isAllowed = await isAnswersPageAllowed(req, res, siteConfig);

  if (!isAllowed) {
    const errorMessage = getAnswersPageErrorMessage(siteConfig);
    return {
      props: {
        siteConfig,
        authorizationError: true,
        errorMessage,
      },
    };
  }

  return {
    props: { siteConfig },
  };
};

export default AllAnswers;
