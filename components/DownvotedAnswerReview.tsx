import React, { useState } from 'react';
import Link from 'next/link';
import { Answer, AdminAction } from '@/types/answer';
import TruncatedMarkdown from './TruncatedMarkdown';
import SourcesList from './SourcesList';
import { useMultipleCollections } from '../hooks/useMultipleCollections';
import { SiteConfig } from '../types/siteConfig';
import { fetchWithAuth } from '@/utils/client/tokenManager';

interface DownvotedAnswerReviewProps {
  answer: Answer;
  siteConfig: SiteConfig;
  isSudoAdmin?: boolean;
}

const DownvotedAnswerReview: React.FC<DownvotedAnswerReviewProps> = ({
  answer,
  siteConfig,
  isSudoAdmin = false,
}) => {
  const hasMultipleCollections = useMultipleCollections(siteConfig);

  const [adminAction, setAdminAction] = useState<AdminAction | undefined>(
    answer.adminAction,
  );

  const handleReview = async (newAction: AdminAction) => {
    try {
      const updatedAction = adminAction === newAction ? undefined : newAction;
      const response = await fetchWithAuth('/api/adminAction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ docId: answer.id, action: updatedAction }),
      });

      if (response.ok) {
        setAdminAction(updatedAction);
      } else {
        console.error('Failed to update admin action');
      }
    } catch (error) {
      console.error('Error updating admin action:', error);
    }
  };

  const formatTimestamp = (
    timestamp:
      | {
          _seconds: number;
          _nanoseconds: number;
        }
      | string
      | null,
  ) => {
    if (!timestamp) {
      return 'Unknown date';
    }

    // Handle string timestamp format
    if (typeof timestamp === 'string') {
      return new Date(timestamp).toLocaleString();
    }

    // Handle Firestore timestamp format
    if (timestamp._seconds) {
      return new Date(timestamp._seconds * 1000).toLocaleString();
    }

    return 'Unknown date';
  };

  // Parse sources if they are stored as a string
  const parsedSources = answer.sources
    ? Array.isArray(answer.sources)
      ? answer.sources
      : (() => {
          try {
            return JSON.parse(answer.sources as unknown as string);
          } catch {
            // Create a basic document structure for text sources
            return [
              {
                pageContent: answer.sources,
                metadata: {
                  type: 'text',
                  title: 'Legacy Source',
                },
              },
            ];
          }
        })()
    : [];

  return (
    <div className="bg-white shadow-md rounded-lg p-4 mb-4">
      <Link
        href={`/answers/${answer.id}`}
        className="text-black-600 hover:underline cursor-pointer"
      >
        <h2 className="text-xl font-semibold mb-2">{answer.question}</h2>
      </Link>
      <div className="mb-4">
        <TruncatedMarkdown markdown={answer.answer || ''} maxCharacters={300} />
      </div>
      {parsedSources.length > 0 && (
        <SourcesList
          sources={parsedSources}
          collectionName={hasMultipleCollections ? answer.collection : null}
          siteConfig={siteConfig}
          isSudoAdmin={isSudoAdmin}
        />
      )}
      {(answer.feedbackReason || answer.feedbackComment) && (
        <div className="mt-3 p-3 bg-red-50 rounded-md border border-red-100">
          {answer.feedbackReason && (
            <div className="mb-2">
              <span className="font-medium text-red-700">Reason:</span>{' '}
              <span className="text-gray-800">{answer.feedbackReason}</span>
            </div>
          )}
          {answer.feedbackComment && (
            <div>
              <span className="font-medium text-red-700">Comments:</span>{' '}
              <span className="text-gray-800">{answer.feedbackComment}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-2 text-sm text-gray-600">
        Downvoted on: {formatTimestamp(answer.timestamp)}
      </div>
      {answer.adminAction && (
        <div className="mt-2 text-sm text-gray-600">
          Previous admin action: {answer.adminAction} on{' '}
          {formatTimestamp(answer.adminActionTimestamp!)}
        </div>
      )}
      <div className="mt-4 flex justify-end space-x-2">
        <button
          onClick={() => handleReview('affirmed')}
          className={`px-4 py-2 rounded ${
            adminAction === 'affirmed' ? 'bg-red-500 text-white' : 'bg-red-200'
          }`}
        >
          Affirm Downvote
        </button>
        <button
          onClick={() => handleReview('ignore')}
          className={`px-4 py-2 rounded ${
            adminAction === 'ignore' ? 'bg-gray-500 text-white' : 'bg-gray-200'
          }`}
        >
          Ignore
        </button>
        <button
          onClick={() => handleReview('fixed')}
          className={`px-4 py-2 rounded ${
            adminAction === 'fixed' ? 'bg-green-500 text-white' : 'bg-green-200'
          }`}
        >
          Fixed
        </button>
      </div>
    </div>
  );
};

export default DownvotedAnswerReview;
