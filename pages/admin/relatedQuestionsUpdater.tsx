import React, { useState } from 'react';
import { fetchWithAuth } from '@/utils/client/tokenManager';
import Layout from '@/components/layout';
import { SiteConfig } from '@/types/siteConfig';
import { GetServerSideProps, NextApiRequest } from 'next';
import { loadSiteConfig } from '@/utils/server/loadSiteConfig';
import { getSudoCookie } from '@/utils/server/sudoCookieUtils';
import { db } from '@/services/firebase'; // Import Firestore db instance
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils'; // Import the utility function

// Define props type including siteConfig and totalQuestions
interface RelatedQuestionsUpdaterProps {
  siteConfig: SiteConfig | null;
  totalQuestions: number | null; // Add totalQuestions prop
}

const RelatedQuestionsUpdater = ({
  siteConfig,
  totalQuestions, // Destructure totalQuestions
}: RelatedQuestionsUpdaterProps) => {
  const [batchSize, setBatchSize] = useState<number>(10);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null); // Add state for execution time

  const handleUpdateClick = async () => {
    if (batchSize <= 0) {
      setApiError('Batch size must be a positive number.');
      return;
    }

    setIsLoading(true);
    setApiMessage(null);
    setApiError(null);
    setExecutionTime(null); // Reset execution time
    const startTime = performance.now(); // Start timer

    try {
      const response = await fetchWithAuth(
        `/api/relatedQuestions?updateBatch=${batchSize}`,
        {
          method: 'GET',
        },
      );

      // Check if the response is not OK (includes 4xx, 5xx errors)
      if (!response.ok) {
        let errorMessage = `HTTP error ${response.status}`;
        // Specifically handle gateway timeouts (504)
        if (response.status === 504) {
          errorMessage =
            'The update process timed out (504 Gateway Timeout). This might happen with large batch sizes or during high server load.';
        } else {
          // Try to parse JSON for other errors, but anticipate failure
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorMessage; // Use message from response if available
          } catch (parseError) {
            // If JSON parsing fails, stick with the HTTP status message
            console.error('Failed to parse error response JSON:', parseError);
          }
        }
        throw new Error(errorMessage); // Throw an error with the determined message
      }

      // If response IS ok, parse the JSON
      const data = await response.json();
      setApiMessage(data.message || 'Update initiated successfully.');
    } catch (error: any) {
      console.error('Error triggering related questions update:', error);
      setApiError(
        `Failed to trigger update: ${error.message || 'Unknown error'}`,
      );
    } finally {
      setIsLoading(false);
      const endTime = performance.now(); // End timer
      const duration = (endTime - startTime) / 1000; // Calculate duration in seconds
      setExecutionTime(parseFloat(duration.toFixed(1))); // Set execution time with one decimal place
    }
  };

  // Render the form - siteConfig is guaranteed by getServerSideProps or page returns 404
  return (
    <Layout siteConfig={siteConfig}>
      <div className="p-4 max-w-md mx-auto">
        <h1 className="text-xl font-semibold mb-4">
          Manual Related Questions Updater
        </h1>
        {/* Display total questions */}
        {totalQuestions !== null ? (
          <p className="mb-4 text-sm text-gray-700">
            Total questions in database: <strong>{totalQuestions}</strong>
          </p>
        ) : (
          <p className="mb-4 text-sm text-yellow-700">
            Could not load total question count.
          </p>
        )}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading && batchSize > 0) {
                e.preventDefault(); // Prevent default form submission if any
                handleUpdateClick();
              }
            }}
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

        {/* Display results and execution time */}
        {(apiMessage || apiError || executionTime !== null) && (
          <div className="mt-4 space-y-3">
            {apiMessage && (
              <div className="p-3 bg-green-100 text-green-800 border border-green-300 rounded-md">
                {apiMessage}
              </div>
            )}
            {apiError && (
              <div className="p-3 bg-red-100 text-red-800 border border-red-300 rounded-md">
                {apiError}
              </div>
            )}
            {executionTime !== null && (
              <div className="p-3 bg-blue-100 text-blue-800 border border-blue-300 rounded-md text-sm">
                Request took: {executionTime} seconds.
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default RelatedQuestionsUpdater;

// getServerSideProps to load site config, check admin status, and get question count
export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  let totalQuestions: number | null = null;
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

  // Try to get the total question count if db is available
  if (db) {
    try {
      // Use the utility function to get the correct collection name
      const collectionName = getAnswersCollectionName();
      const questionsCol = db.collection(collectionName);
      const snapshot = await questionsCol.count().get();
      totalQuestions = snapshot.data().count; // Access count from data object
    } catch (error) {
      console.error('Error getting total question count:', error);
      // Keep totalQuestions as null if count fails
    }
  } else {
    console.warn('Firestore DB instance not available in getServerSideProps');
  }

  return {
    props: {
      siteConfig,
      totalQuestions, // Pass the count (or null)
    },
  };
};
