/**
 * This component renders a paginated list of answers with sorting and filtering options.
 * It handles fetching answers from the API, managing user interactions like liking and deleting answers,
 * and preserving scroll position between page navigations.
 *
 * Key features:
 * - Pagination with server-side rendering
 * - Sorting answers by most recent or most popular
 * - Like/unlike functionality with optimistic updates
 * - Copy link to individual answers
 * - Delete answers (for sudo users only)
 * - Scroll position preservation
 * - Debounced API calls to prevent excessive requests
 */

import Layout from '@/components/layout';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import debounce from 'lodash/debounce';
import { Answer } from '@/types/answer';
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

interface AllAnswersProps {
  siteConfig: SiteConfig | null;
}

const AllAnswers = ({ siteConfig }: AllAnswersProps) => {
  const router = useRouter();
  const { sortBy: urlSortBy, page: urlPage } = router.query;
  const [sortBy, setSortBy] = useState<string>('mostRecent');
  const [isSortByInitialized, setIsSortByInitialized] = useState(false);

  const [answers, setAnswers] = useState<Answer[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [likeStatuses, setLikeStatuses] = useState<Record<string, boolean>>({});
  const [linkCopied, setLinkCopied] = useState<string | null>(null);

  // State to track if the data has been loaded at least once
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  // State to control the delayed spinner visibility
  const [, setShowDelayedSpinner] = useState(false);

  const [isRestoringScroll, setIsRestoringScroll] = useState(false);

  const { isSudoUser, checkSudoStatus } = useSudo();

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

  // Reset answers when sort order changes
  useEffect(() => {
    setAnswers([]);
    setTotalPages(1);
  }, [sortBy]);

  const currentFetchRef = useRef<(() => void) | null>(null);
  const hasInitiallyFetched = useRef(false);
  const hasFetchedLikeStatuses = useRef(false);

  // Function to fetch answers from the API
  const fetchAnswers = useCallback(
    async (
      page: number,
      currentSortBy: string,
      isPageChange: boolean = false,
    ) => {
      setIsLoading(true);
      if (isPageChange) {
        setIsChangingPage(true);
        setAnswers([]); // Clear answers when changing page
      }

      try {
        const answersResponse = await fetch(
          `/api/answers?page=${page}&limit=10&sortBy=${currentSortBy}`,
          {
            method: 'GET',
          },
        );
        if (!answersResponse.ok) {
          throw new Error(`HTTP error! status: ${answersResponse.status}`);
        }
        const data = await answersResponse.json();
        setAnswers(data.answers);
        setTotalPages(data.totalPages);

        // Scroll to top after new content is loaded, with a small delay
        if (isPageChange) {
          setTimeout(scrollToTop, 100);
        }
      } catch (error: Error | unknown) {
        console.error('Failed to fetch answers:', error);
        if (error instanceof Error && error.message.includes('429')) {
          throw new Error('Quota exceeded. Please try again later.');
        } else {
          throw new Error('Failed to fetch answers. Please try again.');
        }
      } finally {
        setIsLoading(false);
        setIsChangingPage(false);
      }
    },
    [],
  );

  // Debounced version of fetchAnswers to prevent excessive API calls
  const debouncedFetch = useMemo(
    () =>
      debounce(
        (page: number, sortBy: string, isPageChange: boolean = false) => {
          if (currentFetchRef.current) {
            console.log('Fetch already in progress, skipping');
            return;
          }

          currentFetchRef.current = () => {
            return fetchAnswers(page, sortBy, isPageChange).finally(() => {
              currentFetchRef.current = null;
              if (!hasInitiallyFetched.current) {
                hasInitiallyFetched.current = true;
                setInitialLoadComplete(true);
                setIsRestoringScroll(true);
              }
            });
          };

          // Execute the fetch
          if (currentFetchRef.current) {
            currentFetchRef.current();
          }
        },
        300,
      ),
    [fetchAnswers],
  );

  // Cancel debounced fetch on unmount
  useEffect(() => {
    return () => {
      if (debouncedFetch) {
        debouncedFetch.cancel();
      }
    };
  }, [debouncedFetch]);

  // Initial fetch when component mounts or URL parameters change
  useEffect(() => {
    if (router.isReady && debouncedFetch) {
      const pageFromUrl = Number(urlPage) || 1;
      const sortByFromUrl = (urlSortBy as string) || 'mostRecent';

      setSortBy(sortByFromUrl);
      setCurrentPage(pageFromUrl);
      setIsSortByInitialized(true);

      debouncedFetch(pageFromUrl, sortByFromUrl);
    }
  }, [router.isReady, urlPage, urlSortBy, debouncedFetch]);

  // Function to update URL with current page and sort order
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

  // Fetch like statuses for answers
  useEffect(() => {
    const fetchLikeStatuses = async (answerIds: string[]) => {
      if (hasFetchedLikeStatuses.current) return;

      try {
        const uuid = getOrCreateUUID();
        const statuses = await checkUserLikes(answerIds, uuid);
        setLikeStatuses((prevStatuses) => ({ ...prevStatuses, ...statuses }));
        hasFetchedLikeStatuses.current = true;
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

    if (answers.length > 0 && !hasFetchedLikeStatuses.current) {
      fetchLikeStatuses(answers.map((answer) => answer.id));
    }
  }, [answers]);

  const [likeError, setLikeError] = useState<string | null>(null);

  // Handle like count changes
  const handleLikeCountChange = (answerId: string, newLikeCount: number) => {
    try {
      setAnswers((prevAnswers) => {
        const updatedAnswers = prevAnswers.map((answer) => {
          if (answer.id === answerId) {
            return { ...answer, likeCount: newLikeCount };
          }
          return answer;
        });
        return updatedAnswers;
      });
      logEvent('like_answer', 'Engagement', answerId);
    } catch (error) {
      setLikeError(
        error instanceof Error ? error.message : 'An error occurred',
      );
      setTimeout(() => setLikeError(null), 3000);
    }
  };

  // Handle answer deletion (for sudo users only)
  const handleDelete = async (answerId: string) => {
    if (confirm('Are you sure you want to delete this answer?')) {
      try {
        const response = await fetch(`/api/answers?answerId=${answerId}`, {
          method: 'DELETE',
        });
        const responseData = await response.json();
        if (!response.ok) {
          throw new Error(
            'Failed to delete answer (' + responseData.message + ')',
          );
        }
        setAnswers((prevAnswers) =>
          prevAnswers.filter((answer) => answer.id !== answerId),
        );
        logEvent('delete_answer', 'Admin', answerId);
      } catch (error) {
        console.error('Error deleting answer:', error);
        alert('Failed to delete answer. Please try again.');
      }
    }
  };

  // Handle sort order change
  const handleSortChange = (newSortBy: string) => {
    if (newSortBy !== sortBy) {
      scrollToTop(); // Scroll to top immediately
      setAnswers([]);
      setCurrentPage(1);
      setTotalPages(1);
      setSortBy(newSortBy);
      updateUrl(1, newSortBy);
      setIsChangingPage(true);

      if (debouncedFetch) {
        debouncedFetch(1, newSortBy, true);
      } else {
        console.warn('debouncedFetch is null in handleSortChange');
        fetchAnswers(1, newSortBy, true);
      }

      logEvent('change_sort', 'UI', newSortBy);
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

  // Track if we're changing pages
  const [isChangingPage, setIsChangingPage] = useState(false);

  // Handle page change
  const handlePageChange = (newPage: number) => {
    scrollToTop();
    setIsChangingPage(true);
    setAnswers([]);
    setCurrentPage(newPage);
    sessionStorage.removeItem('answersScrollPosition');
    updateUrl(newPage, sortBy);
    logEvent('change_answers_page', 'UI', `page:${newPage}`);

    setTimeout(() => {
      if (debouncedFetch) {
        debouncedFetch(newPage, sortBy, true);
      } else {
        console.warn('debouncedFetch is null in handlePageChange');
        fetchAnswers(newPage, sortBy, true);
      }
    }, 0);
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
              <p className="text-lg text-gray-600 ml-4">Loading...</p>
            </div>
          ) : (
            <div key={`${currentPage}-${sortBy}`}>
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

              {/* Only render pagination controls when answers are loaded */}
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
        {/* Error message display */}
        {likeError && (
          <div className="text-red-500 text-sm mt-2 text-center">
            {likeError}
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
