import Layout from '@/components/layout';
import DownvotedAnswerReview from '@/components/DownvotedAnswerReview';
import { SiteConfig } from '@/types/siteConfig';
import { SudoProvider } from '@/contexts/SudoContext';
import { useDownvotedAnswers } from '@/hooks/useAnswers';
import { Answer } from '@/types/answer';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface DownvotesReviewProps {
  siteConfig: SiteConfig | null;
}

const DownvotesReview = ({ siteConfig }: DownvotesReviewProps) => {
  const router = useRouter();
  const page = parseInt(router.query.page as string) || 1;
  const [isChangingPage, setIsChangingPage] = useState(false);

  const { data, isLoading, error } = useDownvotedAnswers(page);

  // Reset isChangingPage when data loads or router is ready
  useEffect(() => {
    if (data && !isLoading) {
      setIsChangingPage(false);
    }
  }, [data, isLoading]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || (data?.totalPages && newPage > data.totalPages)) {
      return;
    }
    setIsChangingPage(true);
    router.push({
      pathname: router.pathname,
      query: { ...router.query, page: newPage },
    });
  };

  if (isLoading && !data) {
    return (
      <SudoProvider>
        <Layout siteConfig={siteConfig}>
          <div className="flex justify-center items-center min-h-screen">
            <div
              role="status"
              className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-600"
              aria-label="Loading"
            ></div>
          </div>
        </Layout>
      </SudoProvider>
    );
  }

  if (!siteConfig) {
    return (
      <SudoProvider>
        <Layout siteConfig={null}>
          Error: Site configuration not available
        </Layout>
      </SudoProvider>
    );
  }

  if (error) {
    return (
      <SudoProvider>
        <Layout siteConfig={siteConfig}>
          <div className="text-red-600">
            Error:{' '}
            {error instanceof Error
              ? error.message
              : 'Failed to fetch downvoted answers'}
          </div>
        </Layout>
      </SudoProvider>
    );
  }

  return (
    <SudoProvider>
      <Layout siteConfig={siteConfig}>
        <h1 className="text-2xl font-bold mb-4">Review Downvoted Answers</h1>
        {!data?.answers || data.answers.length === 0 ? (
          <p>No downvoted answers to review.</p>
        ) : (
          <>
            <div className="space-y-6">
              {data.answers.map((answer: Answer) => (
                <DownvotedAnswerReview
                  key={answer.id}
                  answer={answer}
                  siteConfig={siteConfig}
                />
              ))}
            </div>

            {/* Pagination controls */}
            <div className="flex justify-center mt-6 space-x-4">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1 || isChangingPage}
                className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
              >
                Previous
              </button>
              <span className="px-4 py-2">
                Page {data.currentPage} of {data.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= data.totalPages || isChangingPage}
                className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
              >
                Next
              </button>
            </div>
          </>
        )}
      </Layout>
    </SudoProvider>
  );
};

export default DownvotesReview;
