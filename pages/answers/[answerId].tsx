// This component renders a single answer page, fetching and displaying the answer details,
// handling likes, and providing admin functionality for deletion.

import { SiteConfig } from '@/types/siteConfig';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '@/components/layout';
import AnswerItem from '@/components/AnswerItem';
import { Answer } from '@/types/answer';
import { checkUserLikes } from '@/services/likeService';
import { getOrCreateUUID } from '@/utils/client/uuid';
import { logEvent } from '@/utils/client/analytics';
import Head from 'next/head';
import { getShortname } from '@/utils/client/siteConfig';
import { useSudo } from '@/contexts/SudoContext';
import { queryFetch } from '@/utils/client/reactQueryConfig';

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
  const [likeError, setLikeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the answer data when the component mounts or answerId changes
  useEffect(() => {
    const fetchAnswer = async () => {
      if (!answerId) return;

      setIsLoading(true);
      setError(null);

      try {
        // Use queryFetch instead of fetch to add JWT authentication
        const response = await queryFetch(`/api/answers?answerIds=${answerId}`);

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
    const fetchLikeStatuses = async (answerIds: string[]) => {
      if (!answerIds.length) return;

      try {
        const uuid = getOrCreateUUID();
        const statuses = await checkUserLikes(answerIds, uuid);

        // Important: completely replace the state, don't merge with previous
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

    if (answer) {
      fetchLikeStatuses([answer.id]);
    }
  }, [answer]);

  // Handle like count changes
  const handleLikeCountChange = (answerId: string) => {
    try {
      // Update the answer with the new like count - calculate based on current status
      if (answer) {
        // Calculate new like count based on the new status (inverse of current)
        const wasLiked = likeStatuses[answerId] || false;
        const newLikeCount = wasLiked
          ? Math.max(0, answer.likeCount - 1)
          : answer.likeCount + 1;

        setAnswer({
          ...answer,
          likeCount: newLikeCount,
        });
      }

      // Update the like status immediately (don't wait for server refresh)
      const newLikeStatus = !likeStatuses[answerId];

      // Create a new object to ensure state update
      setLikeStatuses({
        ...likeStatuses,
        [answerId]: newLikeStatus,
      });

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
          {getShortname(siteConfig)}: {answer.question.substring(0, 150)}
        </title>
      </Head>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <AnswerItem
          answer={answer}
          siteConfig={siteConfig}
          handleLikeCountChange={handleLikeCountChange}
          handleCopyLink={handleCopyLink}
          handleDelete={handleDelete}
          linkCopied={linkCopied ? answer.id : null}
          likeStatuses={likeStatuses}
          isSudoUser={isSudoUser}
          isFullPage={true}
        />
        {likeError && (
          <div className="text-red-500 text-sm mt-2">{likeError}</div>
        )}
      </div>
    </Layout>
  );
};

export default SingleAnswer;
