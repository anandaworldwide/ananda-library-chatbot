import Layout from '@/components/layout';
import DownvotedAnswerReview from '@/components/DownvotedAnswerReview';
import { SiteConfig } from '@/types/siteConfig';
import { SudoProvider } from '@/contexts/SudoContext';
import { useDownvotedAnswers } from '@/hooks/useAnswers';
import { Answer } from '@/types/answer';

interface DownvotesReviewProps {
  siteConfig: SiteConfig | null;
}

const DownvotesReview = ({ siteConfig }: DownvotesReviewProps) => {
  const { data: downvotedAnswers, isLoading, error } = useDownvotedAnswers();

  if (isLoading) {
    return (
      <SudoProvider>
        <Layout siteConfig={siteConfig}>Loading...</Layout>
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
        {!downvotedAnswers || downvotedAnswers.length === 0 ? (
          <p>No downvoted answers to review.</p>
        ) : (
          <div className="space-y-6">
            {downvotedAnswers.map((answer: Answer) => (
              <DownvotedAnswerReview
                key={answer.id}
                answer={answer}
                siteConfig={siteConfig}
              />
            ))}
          </div>
        )}
      </Layout>
    </SudoProvider>
  );
};

export default DownvotesReview;
