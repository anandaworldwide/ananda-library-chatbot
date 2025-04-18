// This component renders a single answer page, fetching and displaying the answer details,
// handling likes, and providing admin functionality for deletion.

// Special features:
// - GETHUMAN links: For the 'ananda-public' site ID, links in the format [text](GETHUMAN)
//   are automatically converted to links to the Ananda contact page (https://www.ananda.org/contact-us/)

import { SiteConfig } from '@/types/siteConfig';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '@/components/layout';
import AnswerItem from '@/components/AnswerItem';
import { Answer } from '@/types/answer';
import { checkUserLikes, updateLike } from '@/services/likeService';
import { getOrCreateUUID } from '@/utils/client/uuid';
import { logEvent } from '@/utils/client/analytics';
import Head from 'next/head';
import { getShortname } from '@/utils/client/siteConfig';
import { useSudo } from '@/contexts/SudoContext';
import { queryFetch } from '@/utils/client/reactQueryConfig';
import { isAuthenticated } from '@/utils/client/tokenManager';
import ReactMarkdown from 'react-markdown';
import gfm from 'remark-gfm';
import { Components } from 'react-markdown';

interface SingleAnswerProps {
  siteConfig: SiteConfig | null;
}

const SingleAnswer = ({ siteConfig }: SingleAnswerProps) => {
  const router = useRouter();
  const { answerId } = router.query;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [likeStatuses, setLikeStatuses] = useState<Record<string, boolean>>({});
  const [notFound, setNotFound] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const { isSudoUser } = useSudo();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom link component to handle GETHUMAN links, similar to TruncatedMarkdown
  const LinkComponent: Components['a'] = ({ href, children, ...props }) => {
    if (siteConfig?.siteId === 'ananda-public' && href === 'GETHUMAN') {
      return (
        <a href="https://www.ananda.org/contact-us/" {...props}>
          {children}
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  };

  // Check if the user is authenticated
  const userIsAuthenticated = isAuthenticated();

  // For sites requiring login, only allow likes if authenticated
  const allowLikes = siteConfig?.requireLogin === false || userIsAuthenticated;

  // Fetch the answer data when the component mounts or answerId changes
  useEffect(() => {
    const fetchAnswer = async () => {
      if (!answerId) return;

      setIsLoading(true);
      setError(null);

      try {
        // Use regular fetch since viewing answers doesn't require authentication
        const response = await fetch(`/api/answers?answerIds=${answerId}`);

        if (response.status === 404) {
          setNotFound(true);
          return;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to fetch answer');
        }

        const data = await response.json();
        if (data && data.length > 0) {
          setAnswer(data[0]);
        } else {
          setNotFound(true);
        }
      } catch (error) {
        console.error('Error fetching answer:', error);
        setError(
          error instanceof Error ? error.message : 'Failed to load answer',
        );
      } finally {
        setIsLoading(false);
      }
    };

    if (answerId) {
      fetchAnswer();
    }
  }, [answerId]);

  // Fetch like statuses for the answer when it's loaded
  useEffect(() => {
    // Skip fetching like statuses if likes are not allowed for unauthenticated users
    if (!allowLikes) {
      console.log('User not authenticated - skipping like status fetch');
      return;
    }

    const fetchLikeStatuses = async (answerIds: string[]) => {
      if (!answerIds.length) return;

      try {
        const uuid = getOrCreateUUID();
        // Pass the site config to determine appropriate auth handling
        const statuses = await checkUserLikes(answerIds, uuid, siteConfig);

        // Important: completely replace the state, don't merge with previous
        setLikeStatuses(statuses);
      } catch (error) {
        // Just log errors, don't display them to users
        console.error('Error fetching like statuses:', error);
        // Set default like status to false for errors
        if (answerIds.length > 0) {
          const defaultStatuses: Record<string, boolean> = {};
          answerIds.forEach((id) => {
            defaultStatuses[id] = false;
          });
          setLikeStatuses(defaultStatuses);
        }
      }
    };

    if (answer) {
      fetchLikeStatuses([answer.id]);
    }
  }, [answer, siteConfig, allowLikes]);

  // Scroll the main answer item into view after it's loaded/rendered
  // NOTE: Moved before early returns to satisfy rules-of-hooks
  useEffect(() => {
    if (answer) {
      // Use a timeout to ensure the DOM is updated after state change
      const timer = setTimeout(() => {
        const mainAnswerElement = document.getElementById('main-answer-item');
        if (mainAnswerElement) {
          mainAnswerElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center', // Scroll to the center of the element
          });
        }
      }, 150); // Delay to allow rendering

      return () => clearTimeout(timer); // Cleanup timeout
    }
  }, [answer]); // Dependency array includes the answer object

  // Handle like count changes
  const handleLikeCountChange = async (answerId: string) => {
    // Security check - don't allow likes for unauthenticated users
    if (!allowLikes) {
      console.log('User not authenticated - like action prevented');
      return;
    }

    try {
      // Get the current like status
      const wasLiked = likeStatuses[answerId] || false;
      const newLikeStatus = !wasLiked;

      // Update the answer with the new like count
      if (answer) {
        // Calculate new like count based on the new status
        const newLikeCount = wasLiked
          ? Math.max(0, answer.likeCount - 1)
          : answer.likeCount + 1;

        setAnswer({
          ...answer,
          likeCount: newLikeCount,
        });
      }

      // Update the like status immediately in UI
      setLikeStatuses({
        ...likeStatuses,
        [answerId]: newLikeStatus,
      });

      // Log the event
      logEvent('like_answer', 'Engagement', answerId);

      // Update the like status on the server
      const uuid = getOrCreateUUID();
      await updateLike(answerId, uuid, newLikeStatus, siteConfig);
    } catch (error) {
      // Just log the error, don't display any UI error messages
      console.error('Error updating like status:', error);

      // Revert the UI state on error
      if (
        answer &&
        error instanceof Error &&
        error.message.includes('Authentication required')
      ) {
        // Revert the like count
        const wasLiked = likeStatuses[answerId] || false;
        const originalLikeCount = wasLiked
          ? answer.likeCount + 1 // if it was liked and we "unliked" it, add 1 back
          : Math.max(0, answer.likeCount - 1); // if it wasn't liked and we "liked" it, subtract 1

        setAnswer({
          ...answer,
          likeCount: originalLikeCount,
        });

        // Revert the like status
        setLikeStatuses({
          ...likeStatuses,
          [answerId]: wasLiked,
        });
      }
    }
  };

  // Handle copying the answer link to clipboard
  const handleCopyLink = () => {
    const url = `${window.location.origin}/answers/${answerId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      logEvent('copy_link', 'Engagement', `Answer ID: ${answerId}`);
    });
  };

  // Handle answer deletion (admin functionality)
  const handleDelete = async (answerId: string) => {
    if (confirm('Are you sure you want to delete this answer?')) {
      try {
        // Use queryFetch instead of fetch to add JWT authentication
        const response = await queryFetch(`/api/answers?answerId=${answerId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const responseData = await response.json();
          throw new Error(
            'Failed to delete answer (' + responseData.message + ')',
          );
        }

        router.push('/answers');
        logEvent('delete_answer', 'Admin', answerId);
      } catch (error) {
        console.error('Error deleting answer:', error);
        alert('Failed to delete answer. Please try again.');
      }
    }
  };

  // Get whether related questions should be shown (defaults to true)
  const showRelatedQuestions = siteConfig?.showRelatedQuestions ?? true;

  // Render "not found" message if the answer doesn't exist
  if (notFound) {
    return (
      <Layout siteConfig={siteConfig}>
        <div className="flex justify-center items-center h-screen">
          <p className="text-lg text-gray-600">Answer not found.</p>
        </div>
      </Layout>
    );
  }

  // Show error message if there was an error fetching the answer
  if (error) {
    return (
      <Layout siteConfig={siteConfig}>
        <div className="flex flex-col justify-center items-center h-screen">
          <p className="text-lg text-red-600 mb-4">Error: {error}</p>
          <button
            onClick={() => router.push('/answers')}
            className="bg-blue-500 text-white px-4 py-2 rounded-md"
          >
            Go Back to All Answers
          </button>
        </div>
      </Layout>
    );
  }

  // Render loading spinner while fetching the answer
  if (isLoading || !answer) {
    return (
      <Layout siteConfig={siteConfig}>
        <div className="flex justify-center items-center h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-600"></div>
          <p className="text-lg text-gray-600 ml-4">Loading...</p>
        </div>
      </Layout>
    );
  }

  // Render the answer details
  return (
    <Layout siteConfig={siteConfig}>
      <Head>
        <title>
          {getShortname(siteConfig)}: {answer?.question?.substring(0, 150)}
        </title>
      </Head>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Render Conversation History if available */}
        {answer?.history &&
          Array.isArray(answer.history) &&
          answer.history.length > 0 && (
            <div className="mb-8 p-4 border border-gray-200 rounded-lg bg-gray-50">
              <h2 className="text-lg font-semibold mb-3 text-gray-700">
                Conversation History
              </h2>
              <div className="space-y-3">
                {answer.history.map(
                  (turn: { role: string; content: string }, index: number) => (
                    <div
                      key={index}
                      className={`p-3 rounded-md ${
                        turn.role === 'user'
                          ? 'bg-blue-50 text-blue-900'
                          : 'bg-green-50 text-green-900'
                      }`}
                    >
                      <span className="font-medium capitalize">
                        {turn.role}:
                      </span>{' '}
                      <ReactMarkdown
                        remarkPlugins={[gfm]}
                        className="mt-1 prose prose-sm max-w-none text-gray-800"
                        components={{
                          a: LinkComponent, // Use the custom link handler
                        }}
                      >
                        {typeof turn.content === 'string'
                          ? turn.content
                          : JSON.stringify(turn.content)}
                      </ReactMarkdown>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

        {/* Render Main Answer */}
        {answer && (
          // Add id here for scrolling
          <div id="main-answer-item">
            <AnswerItem
              answer={answer}
              // Only pass handleLikeCountChange if likes are allowed for this user
              handleLikeCountChange={
                allowLikes ? handleLikeCountChange : undefined
              }
              handleCopyLink={handleCopyLink}
              handleDelete={handleDelete}
              linkCopied={linkCopied ? answer.id : null}
              likeStatuses={likeStatuses}
              isSudoUser={isSudoUser}
              isFullPage={true}
              siteConfig={siteConfig}
              showRelatedQuestions={showRelatedQuestions}
            />
          </div>
        )}
      </div>
    </Layout>
  );
};

export default SingleAnswer;
