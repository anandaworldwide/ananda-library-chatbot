import React, { useState } from 'react';
import { fetchWithAuth } from '@/utils/client/tokenManager';
import Layout from '@/components/layout';
import { SiteConfig } from '@/types/siteConfig';
import { GetServerSideProps, NextApiRequest } from 'next';
import { loadSiteConfig } from '@/utils/server/loadSiteConfig';
import { getSudoCookie } from '@/utils/server/sudoCookieUtils';

// Define props type including siteConfig from getServerSideProps
interface RelatedQuestionsUpdaterProps {
  siteConfig: SiteConfig | null;
}

const RelatedQuestionsUpdater = ({
  siteConfig,
}: RelatedQuestionsUpdaterProps) => {
  const [batchSize, setBatchSize] = useState<number>(10);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleUpdateClick = async () => {
    if (batchSize <= 0) {
      setApiError('Batch size must be a positive number.');
      return;
    }

    setIsLoading(true);
    setApiMessage(null);
    setApiError(null);

    try {
      const response = await fetchWithAuth(
        `/api/relatedQuestions?updateBatch=${batchSize}`,
        {
          method: 'GET',
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `HTTP error ${response.status}`);
      }

      setApiMessage(data.message || 'Update initiated successfully.');
    } catch (error: any) {
      console.error('Error triggering related questions update:', error);
      setApiError(
        `Failed to trigger update: ${error.message || 'Unknown error'}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Render the form - siteConfig is guaranteed by getServerSideProps or page returns 404
  return (
    <Layout siteConfig={siteConfig}>
      <div className="p-4 max-w-md mx-auto">
        <h1 className="text-xl font-semibold mb-4">
          Manual Related Questions Updater
        </h1>
        <p className="mb-4 text-sm text-gray-600">
          Trigger a batch update of related questions. This process involves
          embedding generation and vector search, which can take time.
        </p>
        <div className="mb-4">
          <label
            htmlFor="batchSize"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Batch Size:
          </label>
          <input
            type="number"
            id="batchSize"
            value={batchSize}
            onChange={(e) => setBatchSize(parseInt(e.target.value, 10) || 0)}
            min="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            disabled={isLoading}
          />
        </div>

        <button
          onClick={handleUpdateClick}
          disabled={isLoading || batchSize <= 0}
          className={`w-full px-4 py-2 bg-indigo-600 text-white rounded-md shadow-sm ${
            isLoading || batchSize <= 0
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-indigo-700'
          } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
        >
          {isLoading ? 'Updating...' : 'Start Update Batch'}
        </button>

        {apiMessage && (
          <div className="mt-4 p-3 bg-green-100 text-green-800 border border-green-300 rounded-md">
            {apiMessage}
          </div>
        )}
        {apiError && (
          <div className="mt-4 p-3 bg-red-100 text-red-800 border border-red-300 rounded-md">
            {apiError}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default RelatedQuestionsUpdater;

// getServerSideProps to load site config and check admin status
export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const siteConfig = await loadSiteConfig();
  const sudoStatus = getSudoCookie(req as NextApiRequest);

  // If not a sudo user, block access to this admin page
  if (!sudoStatus.sudoCookieValue) {
    return {
      notFound: true, // Return 404 page
    };
  }

  // If siteConfig couldn't be loaded (should ideally not happen, but handle defensively)
  if (!siteConfig) {
    console.error('Admin page failed to load site config');
    return {
      notFound: true,
    };
  }

  return {
    props: {
      siteConfig,
    },
  };
};
