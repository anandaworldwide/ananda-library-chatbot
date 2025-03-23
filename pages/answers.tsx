/**
 * This component uses React Query for data fetching with JWT authentication while preserving
 * scroll position preservation and optimistic updates.
 *
 * Key features:
 * - Pagination with server-side rendering
 * - Sorting answers by most recent or most popular
 * - Like/unlike functionality with optimistic updates
 * - Copy link to individual answers
 * - Delete answers (for sudo users only)
 * - Scroll position preservation
 * - JWT authentication with React Query
 */

import Layout from '@/components/layout';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { checkUserLikes } from '@/services/likeService';
import { getOrCreateUUID } from '@/utils/client/uuid';
import { useRouter } from 'next/router';
import { logEvent } from '@/utils/client/analytics';
import React from 'react';
import { GetServerSideProps } from 'next';
import AnswerItem from '@/components/AnswerItem';
import { SiteConfig } from '@/types/siteConfig';
import { loadSiteConfig } from '@/utils/server/loadSiteConfig';
import { getSudoCookie } from '@/utils/server/sudoCookieUtils';
import { NextApiRequest, NextApiResponse } from 'next';
import { useSudo } from '@/contexts/SudoContext';
import { SudoProvider } from '@/contexts/SudoContext';
import { useAnswers } from '@/hooks/useAnswers';
import { useMutation } from '@tanstack/react-query';
import { queryFetch } from '@/utils/client/reactQueryConfig';

interface AllAnswersProps {
  siteConfig: SiteConfig | null;
}

const AllAnswers = ({ siteConfig }: AllAnswersProps) => {
  const router = useRouter();
  const { isSudoUser, checkSudoStatus } = useSudo();

  // Parse query parameters
  const urlPage = router.query.page ? Number(router.query.page) : 1;
  const urlSortBy = router.query.sortBy || 'mostRecent';

  // UI state
  const [sortBy, setSortBy] = useState<string>('mostRecent');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isSortByInitialized, setIsSortByInitialized] = useState(false);
  const [isChangingPage, setIsChangingPage] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [isRestoringScroll, setIsRestoringScroll] = useState(false);
  const [likeStatuses, setLikeStatuses] = useState<Record<string, boolean>>({});
  const [linkCopied, setLinkCopied] = useState<string | null>(null);
  const [likeError, setLikeError] = useState<string | null>(null);

  // Refs for scroll management
  const scrollPositionRef = useRef<number>(0);
  const hasInitiallyFetched = useRef(false);

  // State for delayed spinner
  const [showDelayedSpinner, setShowDelayedSpinner] = useState(false);

  // Use React Query for data fetching with JWT authentication
  const { data, isLoading, error } = useAnswers(currentPage, sortBy, {
    enabled: isSortByInitialized && router.isReady,
  });

  // Show delayed spinner for long-running loads
  useEffect(() => {
    // Set a timeout to show the spinner after 1.5 seconds
    const timer = setTimeout(() => {
      if (isLoading) {
        setShowDelayedSpinner(true);
      }
    }, 1500);

    // Clear the timeout if the component unmounts or isLoading changes to false
    return () => clearTimeout(timer);
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
  const answers = useMemo(() => data?.answers || [], [data?.answers]);
  const totalPages = useMemo(() => data?.totalPages || 1, [data?.totalPages]);

  // Delete mutation with React Query
  const deleteMutation = useMutation({
    mutationFn: async (answerId: string) => {
      const response = await queryFetch(`/api/answers?answerId=${answerId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(
          'Failed to delete answer (' + responseData.message + ')',
        );
      }
      return response.json();
    },
    onSuccess: (data, answerId) => {
      logEvent('delete_answer', 'Admin', answerId);
    },
    onError: (error) => {
      console.error('Error deleting answer:', error);
      alert('Failed to delete answer. Please try again.');
    },
  });

  // Scroll position management functions
  const saveScrollPosition = () => {
    const scrollY = window.scrollY;
    if (scrollY > 0) {
      sessionStorage.setItem('answersScrollPosition', scrollY.toString());
    }
  };

  const getSavedScrollPosition = () => {
    const savedPosition = sessionStorage.getItem('answersScrollPosition');
    return savedPosition ? parseInt(savedPosition, 10) : 0;
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'auto',
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
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Handle popstate event for browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setIsRestoringScroll(true);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Restore scroll position when navigating back
  useEffect(() => {
    if (isRestoringScroll && !isLoading && initialLoadComplete) {
      const savedPosition = getSavedScrollPosition();
      setTimeout(() => {
        window.scrollTo({
          top: savedPosition,
          behavior: 'auto',
        });
        setIsRestoringScroll(false);
        sessionStorage.removeItem('answersScrollPosition');
      }, 100);
    }
  }, [isRestoringScroll, isLoading, initialLoadComplete]);

  // Initialize based on URL parameters
  useEffect(() => {
    if (router.isReady) {
      const pageFromUrl = Number(urlPage) || 1;
      const sortByFromUrl = (urlSortBy as string) || 'mostRecent';

      setSortBy(sortByFromUrl);
      setCurrentPage(pageFromUrl);
      setIsSortByInitialized(true);
    }
  }, [router.isReady, urlPage, urlSortBy]);

  // Update URL with current page and sort order
  const updateUrl = useCallback(
    (page: number, sortBy: string) => {
      if (router.isReady) {
        let path = '/answers';
        const params = new URLSearchParams();

        if (page !== 1) {
          params.append('page', page.toString());
        }

        if (sortBy !== 'mostRecent') {
          params.append('sortBy', sortBy);
        }

        if (params.toString()) {
          path += '?' + params.toString();
        }

        // Use router.replace() with the 'as' parameter
        router.replace(
          {
            pathname: '/answers',
            query: { page: page.toString(), sortBy },
          },
          path,
          { shallow: true },
        );
      }
    },
    [router],
  );

  // Update URL when sort order changes
  useEffect(() => {
    if (router.isReady && isSortByInitialized) {
      const currentSortBy = router.query.sortBy as string | undefined;
      if (sortBy !== currentSortBy) {
        updateUrl(currentPage, sortBy);
      }
    }
  }, [
    sortBy,
    currentPage,
    router.isReady,
    isSortByInitialized,
    router.query.sortBy,
    updateUrl,
  ]);

  // Fetch like statuses for answers
  useEffect(() => {
    const fetchLikeStatuses = async () => {
      if (answers.length === 0) return;

      try {
        const uuid = getOrCreateUUID();
        const answerIds = answers.map((answer) => answer.id);
        const statuses = await checkUserLikes(answerIds, uuid);

        // Important: replace the state entirely, don't merge with previous
        setLikeStatuses(statuses);
      } catch (error) {
        console.error('Error fetching like statuses:', error);
        setLikeError(
          error instanceof Error
            ? error.message
            : 'An error occurred while checking likes.',
        );
        setTimeout(() => setLikeError(null), 5000); // Clear error after 5 seconds
      }
    };

    fetchLikeStatuses();
  }, [answers]);

  // Handle like count changes
  const handleLikeCountChange = (answerId: string) => {
    try {
      // Update the like status immediately (don't wait for server refresh)
      const newLikeStatus = !likeStatuses[answerId];

      // Create a new object to ensure React detects the state change
      setLikeStatuses({
        ...likeStatuses,
        [answerId]: newLikeStatus,
      });

      // Log the event
      logEvent('like_answer', 'Engagement', answerId);

      // Don't refresh like statuses immediately - let the component state handle it
      // The status will be refreshed on the next page load anyway
      // This avoids the blinking effect
    } catch (error) {
      setLikeError(
        error instanceof Error ? error.message : 'An error occurred',
      );
      setTimeout(() => setLikeError(null), 3000);
    }
  };

  // Handle answer deletion (for sudo users only)
  const handleDelete = (answerId: string) => {
    if (confirm('Are you sure you want to delete this answer?')) {
      deleteMutation.mutate(answerId);
    }
  };

  // Handle sort order change
  const handleSortChange = (newSortBy: string) => {
    if (newSortBy !== sortBy) {
      scrollToTop(); // Scroll to top immediately
      setSortBy(newSortBy);
      setCurrentPage(1);
      updateUrl(1, newSortBy);
      setIsChangingPage(true);
      logEvent('change_sort', 'UI', newSortBy);

      // With React Query, we don't need to manually call fetch as it will
      // automatically refetch when dependencies change. However, we need to
      // reset the UI state to show loading state.
      setInitialLoadComplete(false);
      hasInitiallyFetched.current = false;
    }
  };

  // Handle copying answer link
  const handleCopyLink = (answerId: string) => {
    const url = `${window.location.origin}/answers/${answerId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(answerId);
      setTimeout(() => setLinkCopied(null), 2000);
      logEvent('copy_link', 'Engagement', `Answer ID: ${answerId}`);
    });
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    if (newPage === currentPage) return;

    scrollToTop();
    setIsChangingPage(true);
    setCurrentPage(newPage);
    sessionStorage.removeItem('answersScrollPosition');
    updateUrl(newPage, sortBy);
    logEvent('change_answers_page', 'UI', `page:${newPage}`);

    // React Query will handle the data fetching when currentPage changes
    // We just need to reset some UI state
    setInitialLoadComplete(false);
    hasInitiallyFetched.current = false;

    // Save current scroll position
    scrollPositionRef.current = 0;
  };

  // Check sudo status on component mount
  useEffect(() => {
    checkSudoStatus();
  }, [checkSudoStatus]);

  return (
    <SudoProvider>
      <Layout siteConfig={siteConfig}>
        {/* Sort controls */}
        <div className="bg-white shadow">
          <div className="mx-auto max-w-full sm:max-w-4xl px-2 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center">
                <span className="text-gray-700 mr-2">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value)}
                  className="border rounded p-1"
                  disabled={isLoading || !isSortByInitialized}
                >
                  <option value="mostRecent">Most Recent</option>
                  <option value="mostPopular">Most Popular</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-full sm:max-w-4xl px-2 sm:px-6 lg:px-8">
          {/* Loading spinner */}
          {(isLoading && !initialLoadComplete) || isChangingPage ? (
            <div className="flex justify-center items-center h-screen">
              <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-600"></div>
              <p className="text-lg text-gray-600 ml-4">
                {showDelayedSpinner ? 'Still loading...' : 'Loading...'}
              </p>
            </div>
          ) : (
            <div key={`${currentPage}-${sortBy}`}>
              {/* Error state */}
              {error && (
                <div className="text-red-500 text-center my-6">
                  {error instanceof Error
                    ? error.message
                    : 'Error loading answers'}
                </div>
              )}

              {/* List of answers */}
              <div>
                {answers.map((answer) => (
                  <AnswerItem
                    key={answer.id}
                    answer={answer}
                    siteConfig={siteConfig}
                    handleLikeCountChange={handleLikeCountChange}
                    handleCopyLink={handleCopyLink}
                    handleDelete={isSudoUser ? handleDelete : undefined}
                    linkCopied={linkCopied}
                    likeStatuses={likeStatuses}
                    isSudoUser={isSudoUser}
                    isFullPage={false}
                  />
                ))}
              </div>

              {/* Empty state */}
              {answers.length === 0 && !isLoading && !error && (
                <div className="text-center py-8">
                  <p>No answers found.</p>
                </div>
              )}

              {/* Pagination controls */}
              {answers.length > 0 && (
                <div className="flex justify-center mt-4">
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
        {likeError && (
          <div className="text-red-500 text-sm mt-2 text-center">
            {likeError}
          </div>
        )}
        {deleteMutation.isError && (
          <div className="text-red-500 text-sm mt-2 text-center">
            {deleteMutation.error instanceof Error
              ? deleteMutation.error.message
              : 'Failed to delete answer'}
          </div>
        )}
      </Layout>
    </SudoProvider>
  );
};

// Server-side props to load site configuration and check permissions
export const getServerSideProps: GetServerSideProps = async (context) => {
  const siteId = process.env.SITE_ID || 'default';
  const siteConfig = await loadSiteConfig(siteId);

  if (!siteConfig) {
    return {
      notFound: true,
    };
  }

  // Check if all answers page is allowed or if user has sudo access
  if (!siteConfig.allowAllAnswersPage) {
    const req = context.req as unknown as NextApiRequest;
    const res = context.res as unknown as NextApiResponse;

    const sudoStatus = getSudoCookie(req, res);

    if (!sudoStatus.sudoCookieValue) {
      return {
        notFound: true,
      };
    }
  }

  return {
    props: { siteConfig },
  };
};

export default AllAnswers;
