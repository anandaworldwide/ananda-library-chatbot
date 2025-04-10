// This component renders an individual message item in a chat-like interface,
// supporting both user messages and AI responses with various interactive elements.

import React, { Fragment, useState } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import gfm from 'remark-gfm';
import styles from '@/styles/Home.module.css';
import markdownStyles from '@/styles/MarkdownStyles.module.css';
import SourcesList from '@/components/SourcesList';
import CopyButton from '@/components/CopyButton';
import LikeButton from '@/components/LikeButton';
import { SiteConfig } from '@/types/siteConfig';
import { ExtendedAIMessage } from '@/types/ExtendedAIMessage';
import { RelatedQuestion } from '@/types/RelatedQuestion';
import { useSudo } from '@/contexts/SudoContext';
import { useVote } from '@/hooks/useVote';
import { logEvent } from '@/utils/client/analytics';
import { Components } from 'react-markdown';

interface MessageItemProps {
  message: ExtendedAIMessage;
  previousMessage?: ExtendedAIMessage;
  index: number;
  isLastMessage: boolean;
  loading: boolean;
  privateSession: boolean;
  collectionChanged: boolean;
  hasMultipleCollections: boolean;
  likeStatuses: Record<string, boolean>;
  linkCopied: string | null;
  votes?: Record<string, number>;
  siteConfig: SiteConfig | null;
  handleLikeCountChange: (answerId: string, liked: boolean) => void;
  handleCopyLink: (answerId: string) => void;
  handleVote?: (docId: string, isUpvote: boolean) => void;
  lastMessageRef: React.RefObject<HTMLDivElement> | null;
  messageKey: string;
  voteError?: string | null;
  allowAllAnswersPage: boolean;
  showSourcesBelow?: boolean;
}

const MessageItem: React.FC<MessageItemProps> = ({
  message,
  previousMessage,
  index,
  isLastMessage,
  loading,
  privateSession,
  collectionChanged,
  hasMultipleCollections,
  likeStatuses,
  linkCopied,
  votes = {},
  siteConfig,
  handleLikeCountChange,
  handleCopyLink,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleVote: _handleVote,
  lastMessageRef,
  messageKey,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  voteError: _voteError,
  allowAllAnswersPage,
  showSourcesBelow = false, // Default to showing sources above
}) => {
  const [likeError, setLikeError] = useState<string | null>(null);
  const { isSudoUser } = useSudo();
  const voteMutation = useVote();

  // Local state to track current vote status
  const [currentVotes, setCurrentVotes] =
    useState<Record<string, number>>(votes);

  // Properly handle voting with our new hook
  const handleVoteWithHook = (docId: string, isUpvote: boolean) => {
    // Calculate vote value (1, 0, or -1)
    const currentVote = currentVotes[docId] || 0;
    let vote: 0 | 1 | -1;

    if ((isUpvote && currentVote === 1) || (!isUpvote && currentVote === -1)) {
      vote = 0; // Toggle off if clicked again
    } else {
      vote = isUpvote ? 1 : -1;
    }

    // Update local state immediately for UI feedback
    setCurrentVotes((prev) => ({
      ...prev,
      [docId]: vote,
    }));

    // Log the event
    logEvent(
      isUpvote ? 'upvote_answer' : 'downvote_answer',
      'Engagement',
      docId,
      vote,
    );

    // Submit to server via mutation
    voteMutation.mutate({ docId, vote });
  };

  // Handles the like button click, updating the like count and managing errors
  const onLikeButtonClick = (answerId: string, newLikeCount: number) => {
    try {
      handleLikeCountChange(answerId, newLikeCount > 0);
    } catch (error) {
      setLikeError(
        error instanceof Error ? error.message : 'An error occurred',
      );
      // Clear the error message after 3 seconds
      setTimeout(() => setLikeError(null), 3000);
    }
  };

  // Determine the appropriate icon and class based on the message type
  let icon;
  let className;

  if (message.type === 'apiMessage') {
    icon = (
      <Image
        src="/bot-image.png"
        alt="AI"
        width={40}
        height={40}
        className="rounded-sm"
        priority
      />
    );
    className = 'bg-gray-50';
  } else {
    icon = (
      <Image
        src="/usericon.png"
        alt="Me"
        width={30}
        height={30}
        className="rounded-sm"
        priority
      />
    );
    className =
      loading && isLastMessage ? styles.usermessagewaiting : styles.usermessage;
  }

  // Renders related questions if they meet the similarity threshold
  const renderRelatedQuestions = (
    relatedQuestions: RelatedQuestion[] | undefined,
  ) => {
    if (!allowAllAnswersPage) {
      return null;
    }
    if (!relatedQuestions || !Array.isArray(relatedQuestions)) {
      console.error(
        'relatedQuestions is empty or not an array:',
        relatedQuestions,
      );
      return null;
    }

    const SIMILARITY_THRESHOLD = 0.15;
    const filteredQuestions = relatedQuestions.filter(
      (q) => q.similarity >= SIMILARITY_THRESHOLD,
    );

    if (filteredQuestions.length === 0) return null;

    return (
      <div className="bg-gray-200 pt-0.5 pb-3 px-3 rounded-lg mt-2 mb-2">
        <h3 className="text-lg !font-bold mb-2">Related Questions</h3>
        <ul className="list-disc pl-2">
          {filteredQuestions.map((relatedQuestion) => (
            <li key={relatedQuestion.id} className="ml-0">
              <a
                href={`/answers/${relatedQuestion.id}`}
                className="text-blue-600 hover:underline"
              >
                {truncateTitle(relatedQuestion.title, 150)}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // Truncates a title to a specified maximum length
  const truncateTitle = (title: string, maxLength: number) => {
    return title.length > maxLength ? `${title.slice(0, maxLength)}...` : title;
  };

  const renderSources = () => {
    if (message.sourceDocs && message.sourceDocs.length > 0) {
      return (
        <div className={showSourcesBelow ? 'mt-2' : 'mb-2'}>
          <SourcesList
            sources={message.sourceDocs}
            collectionName={
              collectionChanged && hasMultipleCollections
                ? message.collection
                : null
            }
            siteConfig={siteConfig}
            isSudoAdmin={isSudoUser}
          />
        </div>
      );
    }
    return null;
  };

  // Replace the original downvote button implementation
  const renderDownvoteButton = (docId: string) => {
    if (!docId) return null;

    const vote = currentVotes[docId] || 0;

    return (
      <div className="flex items-center">
        <button
          onClick={() => handleVoteWithHook(docId, false)}
          className={`${styles.voteButton} ${
            vote === -1 ? styles.voteButtonDownActive : ''
          } hover:bg-gray-200 flex items-center`}
          title="Downvote (private) for system training"
          disabled={voteMutation.isPending}
        >
          <span className="material-icons text-black">
            {vote === -1 ? 'thumb_down' : 'thumb_down_off_alt'}
          </span>
        </button>
        {voteMutation.isError && (
          <span className="text-red-500 text-sm ml-2">
            {voteMutation.error instanceof Error
              ? voteMutation.error.message
              : 'Error voting'}
          </span>
        )}
      </div>
    );
  };

  const components: Components = {
    a: (props) => {
      // Check if this is a GETHUMAN link for ananda-public site
      if (siteConfig?.siteId === 'ananda-public' && props.href === 'GETHUMAN') {
        // For ananda-public site, convert GETHUMAN links to contact page links
        return (
          <a href="https://www.ananda.org/contact-us/" {...props}>
            {props.children}
          </a>
        );
      }

      // Default link rendering with target and rel attributes
      return (
        <a
          href={props.href}
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {props.children}
        </a>
      );
    },
  };

  return (
    <Fragment key={messageKey}>
      {/* Add a horizontal line between AI messages */}
      {message.type === 'apiMessage' && index > 0 && (
        <hr className="border-t border-gray-200 mb-0" />
      )}
      <div
        className={`${className} p-2 px-3`}
        ref={isLastMessage ? lastMessageRef : null}
      >
        <div className="flex items-start">
          {/* Message icon */}
          <div className="flex-shrink-0 mr-2">{icon}</div>
          <div className="flex-grow">
            <div className="max-w-none">
              {/* Render sources above if not showSourcesBelow */}
              {!showSourcesBelow && renderSources()}

              {/* Render message content */}
              <ReactMarkdown
                remarkPlugins={[gfm]}
                components={components}
                className={`mt-1 ${markdownStyles.markdownanswer}`}
              >
                {message.message
                  .replace(/\n/g, '  \n')
                  .replace(/\n\n/g, '\n\n')}
              </ReactMarkdown>

              {/* Render sources below if showSourcesBelow */}
              {showSourcesBelow && renderSources()}
            </div>
            {/* Action icons container */}
            <div className="mt-2 flex items-center space-x-2">
              {/* Render action buttons for AI messages */}
              {message.type === 'apiMessage' &&
                index !== 0 &&
                !loading &&
                message.docId &&
                isLastMessage && (
                  <>
                    <CopyButton
                      markdown={message.message}
                      answerId={message.docId}
                      sources={message.sourceDocs}
                      question={previousMessage?.message ?? ''}
                      siteConfig={siteConfig}
                    />
                  </>
                )}
              {/* Render additional actions for non-private AI messages */}
              {!privateSession &&
                message.type === 'apiMessage' &&
                message.docId &&
                !loading &&
                isLastMessage && (
                  <>
                    {/* Copy link button */}
                    <button
                      onClick={() => handleCopyLink(message.docId ?? '')}
                      className="text-black-600 hover:underline flex items-center"
                      title="Copy link to clipboard"
                    >
                      <span className="material-icons">
                        {linkCopied === message.docId ? 'check' : 'link'}
                      </span>
                    </button>
                    {/* Like button */}
                    <div className="flex items-center">
                      <LikeButton
                        answerId={message.docId ?? ''}
                        initialLiked={
                          likeStatuses[message.docId ?? ''] || false
                        }
                        likeCount={0}
                        onLikeCountChange={onLikeButtonClick}
                        showLikeCount={false}
                      />
                      {likeError && (
                        <span className="text-red-500 text-sm ml-2">
                          {likeError}
                        </span>
                      )}
                    </div>
                    {/* Use our new downvote button implementation */}
                    {renderDownvoteButton(message.docId ?? '')}
                  </>
                )}
            </div>
            {/* Related questions section */}
            {message.type === 'apiMessage' &&
              message.relatedQuestions &&
              renderRelatedQuestions(message.relatedQuestions)}
          </div>
        </div>
      </div>
    </Fragment>
  );
};

export default MessageItem;
