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
import { logEvent } from '@/utils/client/analytics';
import { Components } from 'react-markdown';
import Link from 'next/link';

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
  handleLikeCountChange: (answerId: string, newLikeCount: number) => void;
  handleCopyLink: (answerId: string) => void;
  handleVote?: (docId: string, isUpvote: boolean) => void;
  lastMessageRef: React.RefObject<HTMLDivElement> | null;
  messageKey: string;
  voteError?: string | null;
  allowAllAnswersPage: boolean;
  showSourcesBelow?: boolean;
  showRelatedQuestions: boolean;
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
  handleVote,
  lastMessageRef,
  messageKey,
  allowAllAnswersPage,
  showSourcesBelow = false,
  showRelatedQuestions,
}) => {
  const { isSudoUser } = useSudo();
  const [forceShowRelated, setForceShowRelated] = useState(false);

  const onLikeButtonClick = (answerId: string) => {
    // Update like status immediately for UI responsiveness
    const newLikeStatus = !likeStatuses[answerId];
    const newLikeCount = newLikeStatus ? 1 : 0; // Messages start with 0 likes
    handleLikeCountChange(answerId, newLikeCount);

    // Log the event (optimistically)
    logEvent('like_answer', 'Engagement', answerId);

    // Server update happens in the parent/hook, error handled there
    // No need to handle errors/revert UI here, keep it simple
  };

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

  // Renders related questions with sudo toggle logic
  const renderRelatedQuestions = (
    relatedQuestions: RelatedQuestion[] | undefined,
  ) => {
    if (!allowAllAnswersPage) return null;
    if (!relatedQuestions || !Array.isArray(relatedQuestions)) return null;
    // Don't show related questions if we're loading and this is the last message
    if (loading && isLastMessage) return null;

    const SIMILARITY_THRESHOLD = 0.15;
    const filteredQuestions = relatedQuestions.filter(
      (q) => q.similarity >= SIMILARITY_THRESHOLD,
    );

    if (filteredQuestions.length === 0) return null;

    // Show only if globally enabled OR if globally disabled but user is sudo and forcing show
    const shouldDisplay =
      showRelatedQuestions || (isSudoUser && forceShowRelated);

    return (
      <>
        {/* Sudo Toggle Button - Show only when globally disabled and user is sudo */}
        {!showRelatedQuestions && isSudoUser && (
          <button
            onClick={() => setForceShowRelated(!forceShowRelated)}
            className="text-sm text-blue-600 hover:underline mt-1 block"
          >
            Admin: {forceShowRelated ? 'hide' : 'show'} related Questions
          </button>
        )}
        {/* Actual Related Questions List - Show if shouldDisplay is true */}
        {shouldDisplay && (
          <div className="bg-gray-200 pt-0.5 pb-3 px-3 rounded-lg mt-2 mb-2">
            <h3 className="text-lg !font-bold mb-2">Related Questions</h3>
            <ul className="list-disc pl-2">
              {filteredQuestions.map((relatedQuestion) => (
                <li key={relatedQuestion.id} className="ml-0">
                  <Link
                    href={`/answers/${relatedQuestion.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {truncateTitle(relatedQuestion.title, 150)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  };

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

  const renderDownvoteButton = (docId: string) => {
    if (!docId) return null;

    const vote = votes[docId] || 0;

    if (!handleVote) {
      console.warn(
        'MessageItem: handleVote prop is missing for downvote button.',
      );
      return null;
    }

    return (
      <div className="flex items-center">
        <button
          onClick={() => handleVote(docId, false)}
          className={`${styles.voteButton} ${
            vote === -1 ? styles.voteButtonDownActive : ''
          } hover:bg-gray-200 flex items-center`}
          title={vote === -1 ? 'Clear downvote' : 'Downvote (provide feedback)'}
        >
          <span className="material-icons text-black">
            {vote === -1 ? 'thumb_down' : 'thumb_down_off_alt'}
          </span>
        </button>
      </div>
    );
  };

  const components: Components = {
    a: ({ href, children, ...props }) => {
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
    },
  };

  return (
    <Fragment key={messageKey}>
      {(message.type === 'apiMessage' || message.type === 'userMessage') &&
        index > 0 && <hr className="border-t border-gray-200 mb-0" />}
      <div
        className={`${className} p-2 px-3`}
        ref={isLastMessage ? lastMessageRef : null}
      >
        <div className="flex items-start">
          <div className="flex-shrink-0 mr-2">{icon}</div>
          <div className="flex-grow">
            <div className="max-w-none">
              {!showSourcesBelow && renderSources()}
              <ReactMarkdown
                remarkPlugins={[gfm]}
                components={components}
                className={`mt-1 ${markdownStyles.markdownanswer}`}
              >
                {message.message
                  .replace(/\n/g, '  \n')
                  .replace(/\n\n/g, '\n\n')}
              </ReactMarkdown>
              {showSourcesBelow && renderSources()}
            </div>
            <div className="mt-2 flex items-center space-x-2">
              {message.type === 'apiMessage' &&
                index !== 0 &&
                (!loading || !isLastMessage) && (
                  <>
                    {/* Copy content button always shown when message is complete */}
                    <CopyButton
                      markdown={message.message}
                      answerId={message.docId || 'unknown'}
                      sources={message.sourceDocs}
                      question={previousMessage?.message ?? ''}
                      siteConfig={siteConfig}
                    />

                    {/* Link, like, and downvote buttons - always visible after loading, but disabled until docId available */}
                    {!privateSession && (
                      <>
                        <button
                          onClick={() =>
                            message.docId && handleCopyLink(message.docId)
                          }
                          className={`text-black-600 hover:underline flex items-center ${
                            !message.docId
                              ? 'opacity-50 cursor-not-allowed'
                              : ''
                          }`}
                          title={
                            message.docId
                              ? 'Copy link to clipboard'
                              : 'Waiting for link...'
                          }
                          disabled={!message.docId}
                        >
                          <span className="material-icons">
                            {linkCopied === message.docId ? 'check' : 'link'}
                          </span>
                        </button>
                        <div className="flex items-center">
                          <LikeButton
                            answerId={message.docId || ''}
                            initialLiked={
                              message.docId
                                ? likeStatuses[message.docId] || false
                                : false
                            }
                            likeCount={0}
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            onLikeCountChange={(answerId, _) => {
                              if (message.docId) {
                                onLikeButtonClick(answerId);
                              }
                            }}
                            showLikeCount={false}
                            disabled={!message.docId}
                          />
                        </div>
                        {message.docId ? (
                          renderDownvoteButton(message.docId)
                        ) : (
                          <div className="flex items-center">
                            <button
                              disabled
                              className="opacity-50 cursor-not-allowed hover:bg-gray-200 flex items-center"
                              title="Waiting for document ID..."
                            >
                              <span className="material-icons text-black">
                                thumb_down_off_alt
                              </span>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
            </div>
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
