// This component renders an individual answer item, including the question, answer content,
// related questions, and interactive elements like likes and copy buttons.

import React, { useState } from "react";
import Link from "next/link";
import TruncatedMarkdown from "@/components/TruncatedMarkdown";
import SourcesList from "@/components/SourcesList";
import CopyButton from "@/components/CopyButton";
import LikeButton from "@/components/LikeButton";
import { Answer } from "@/types/answer";
import { collectionsConfig } from "@/utils/client/collectionsConfig";
import { useMultipleCollections } from "@/hooks/useMultipleCollections";
import { SiteConfig } from "@/types/siteConfig";
import markdownStyles from "@/styles/MarkdownStyles.module.css";
import { DocMetadata } from "@/types/DocMetadata";
import { Document } from "langchain/document";
import { logEvent } from "@/utils/client/analytics";
import { RelatedQuestion } from "@/types/RelatedQuestion";
import { formatAnswerTimestamp } from "@/utils/client/dateUtils";

export interface AnswerItemProps {
  answer: Answer;
  handleLikeCountChange?: (answerId: string, newLikeCount: number) => void;
  handleCopyLink: (answerId: string) => void;
  handleDelete?: (answerId: string) => void;
  linkCopied: string | null;
  likeStatuses: Record<string, boolean>;
  isSudoUser: boolean;
  isFullPage?: boolean;
  siteConfig: SiteConfig | null;
  showRelatedQuestions?: boolean;
}

// Define a simple component for the comment modal
interface CommentModalProps {
  comment: string;
  onClose: () => void;
}

const CommentModal: React.FC<CommentModalProps> = ({ comment, onClose }) => {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4"
      onClick={onClose} // Click outside to close
    >
      <div
        className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg relative"
        onClick={(e) => e.stopPropagation()} // Prevent click inside from closing
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl leading-none"
          aria-label="Close"
        >
          &times;
        </button>
        <h3 className="text-lg font-semibold mb-3">Feedback Comment</h3>
        <p className="text-gray-700 whitespace-pre-wrap">{comment}</p>
      </div>
    </div>
  );
};

const SIMILARITY_THRESHOLD = 0.15;

const AnswerItem: React.FC<AnswerItemProps> = ({
  answer,
  handleLikeCountChange,
  handleCopyLink,
  handleDelete,
  linkCopied,
  likeStatuses,
  isSudoUser,
  isFullPage = false,
  siteConfig,
  showRelatedQuestions = true,
}) => {
  const hasMultipleCollections = useMultipleCollections(siteConfig || undefined);
  const [expanded, setExpanded] = useState(isFullPage);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [forceShowRelated, setForceShowRelated] = useState(false);
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);

  // Renders a truncated version of the question with line breaks
  const renderTruncatedQuestion = (question: string, maxLength: number) => {
    if (!question) {
      console.error("renderTruncatedQuestion called with undefined question");
      return null;
    }
    const truncated = question.slice(0, maxLength);
    return truncated.split("\n").map((line: string, i: number, arr: string[]) => (
      <React.Fragment key={i}>
        {line}
        {i < arr.length - 1 && <br />}
      </React.Fragment>
    ));
  };

  // Truncates a title to a specified maximum length
  const truncateTitle = (title: string, maxLength: number) => {
    return title.length > maxLength ? `${title.slice(0, maxLength)}...` : title;
  };

  // Handle the like button click
  const onLikeButtonClick = (answerId: string, newLikeCount: number) => {
    try {
      // Call the passed handler for parent component updates
      if (handleLikeCountChange) {
        handleLikeCountChange(answerId, newLikeCount);
      }

      // Log the event
      logEvent("like_answer", "Engagement", answerId);
    } catch (error) {
      setLikeError(error instanceof Error ? error.message : "An error occurred");
      // Clear the error message after 3 seconds
      setTimeout(() => setLikeError(null), 3000);
    }
  };

  return (
    <div className={`bg-white p-2 sm:p-2.5 ${isFullPage ? "" : "mb-4"} rounded-lg shadow`}>
      {/* Question section */}
      <div className="flex items-start">
        <span className="material-icons mt-1 mr-2 flex-shrink-0">question_answer</span>
        <div className="flex-grow min-w-0">
          <div className="mb-2">
            {isFullPage ? (
              <b className="block break-words">
                {expanded ? (
                  answer.question.split("\n").map((line: string, i: number) => (
                    <React.Fragment key={i}>
                      {line}
                      {i < answer.question.split("\n").length - 1 && <br />}
                    </React.Fragment>
                  ))
                ) : (
                  <>
                    {renderTruncatedQuestion(answer.question, 600)}
                    {answer.question.length > 600 && "..."}
                  </>
                )}
              </b>
            ) : (
              <Link href={`/answers/${answer.id}`} legacyBehavior>
                <a className="text-black-600 hover:underline cursor-pointer">
                  <b className="block break-words">
                    {expanded ? (
                      answer.question.split("\n").map((line: string, i: number) => (
                        <React.Fragment key={i}>
                          {line}
                          {i < answer.question.split("\n").length - 1 && <br />}
                        </React.Fragment>
                      ))
                    ) : (
                      <>
                        {renderTruncatedQuestion(answer.question, 200)}
                        {answer.question.length > 200 && "..."}
                      </>
                    )}
                  </b>
                </a>
              </Link>
            )}
            {((isFullPage && answer.question.length > 600) || (!isFullPage && answer.question.length > 200)) &&
              !expanded && (
                <button onClick={() => setExpanded(true)} className="text-black hover:underline ml-2">
                  <b>See More</b>
                </button>
              )}
          </div>
          <div className="text-sm text-gray-500 flex flex-wrap items-center">
            <span className="mr-4">{formatAnswerTimestamp(answer.timestamp)}</span>
            {/* Conditionally render history icon */}
            {answer.history && answer.history.length > 0 && (
              <span className="material-icons text-base mr-4" title={`${answer.history.length} messages in history`}>
                chat_bubble_outline
              </span>
            )}
            {hasMultipleCollections && (
              <span>
                {answer.collection
                  ? collectionsConfig[answer.collection as keyof typeof collectionsConfig]?.replace(/ /g, "\u00a0") ||
                    "Unknown\u00a0Collection"
                  : "Unknown\u00a0Collection"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Answer section */}
      <div className="bg-gray-100 p-2 sm:p-2.5 rounded mt-2">
        <div className={`${markdownStyles.markdownanswer} overflow-x-auto`}>
          {/* Render the answer content */}
          <TruncatedMarkdown
            markdown={answer.answer || ""}
            maxCharacters={isFullPage ? 4000 : 600}
            siteConfig={siteConfig}
          />

          {/* Render sources if available */}
          {answer.sources && (
            <SourcesList
              sources={answer.sources as Document<DocMetadata>[]}
              collectionName={hasMultipleCollections ? answer.collection : null}
              siteConfig={siteConfig}
              isSudoAdmin={isSudoUser}
            />
          )}

          {/* Sudo Toggle for Related Questions */}
          {!showRelatedQuestions && isSudoUser && (
            <button
              onClick={() => setForceShowRelated(!forceShowRelated)}
              className="text-sm text-blue-600 hover:underline mt-1 block"
            >
              Admin: {forceShowRelated ? "hide" : "show"} related Questions
            </button>
          )}

          {/* Related Questions Section (Conditional Display) */}
          {answer.relatedQuestionsV2 &&
            answer.relatedQuestionsV2.filter((q: { similarity: number }) => q.similarity >= SIMILARITY_THRESHOLD)
              .length > 0 &&
            (showRelatedQuestions || forceShowRelated) && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Related Questions</h3>
                <div className="space-y-2">
                  {answer.relatedQuestionsV2
                    .filter((q: { similarity: number }) => q.similarity >= SIMILARITY_THRESHOLD)
                    .map((relatedQuestion: RelatedQuestion, index: number) => (
                      <div key={index} className="text-sm">
                        <Link href={`/answers/${relatedQuestion.id}`} className="text-blue-600 hover:text-blue-800">
                          {truncateTitle(relatedQuestion.title, 150)}
                        </Link>
                      </div>
                    ))}
                </div>
              </div>
            )}

          {/* Action buttons section - Reverted Copy Link button style/position */}
          <div className="flex items-center space-x-4 mt-3 text-sm flex-wrap gap-y-2">
            {/* Copy Content Button */}
            <CopyButton
              markdown={answer.answer}
              answerId={answer.id}
              sources={answer.sources as Document<DocMetadata>[] | undefined}
              question={answer.question ?? ""}
              siteConfig={siteConfig}
            />
            {/* Copy Link Button (Icon only, next to Copy Content) */}
            {handleCopyLink && (
              <button
                onClick={() => handleCopyLink(answer.id)}
                className="text-gray-600 hover:text-gray-900 flex items-center p-1 rounded hover:bg-gray-200"
                title="Copy link to clipboard"
              >
                <span className="material-icons">{linkCopied === answer.id ? "check" : "link"}</span>
              </button>
            )}
            {/* Like Button */}
            {handleLikeCountChange && (
              <LikeButton
                answerId={answer.id}
                initialLiked={likeStatuses[answer.id] || false}
                likeCount={answer.likeCount || 0}
                onLikeCountChange={onLikeButtonClick}
                showLikeCount={true}
              />
            )}
            {/* Delete Button */}
            {handleDelete && isSudoUser && (
              <button
                onClick={() => handleDelete(answer.id)}
                className="text-red-600 hover:text-red-800 flex items-center text-lg"
                title="Delete this answer"
              >
                <span className="material-icons text-lg mr-1">delete</span>
                Delete
              </button>
            )}
            {/* Like Error */}
            {likeError && <span className="text-red-500 text-xs">{likeError}</span>}
            {/* IP Address (Aligned Right) */}
            {isSudoUser && answer.ip && <span className="text-base text-gray-400 ml-auto">IP: {answer.ip}</span>}
          </div>

          {/* Sudo Feedback Display Section */}
          {isSudoUser && answer.vote === -1 && answer.feedbackReason && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center space-x-2 text-sm text-gray-600 bg-yellow-50 p-2 rounded">
              <span className="material-icons text-red-600 text-base">thumb_down</span>
              <span className="font-medium">Reason:</span>
              <span>{answer.feedbackReason}</span>
              {answer.feedbackComment && (
                <button
                  onClick={() => setIsCommentModalOpen(true)}
                  className="text-blue-600 hover:text-blue-800 ml-2"
                  title="View Comment"
                >
                  <span className="material-icons text-base align-middle">chat_bubble_outline</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Render Comment Modal */}
      {isCommentModalOpen && answer.feedbackComment && (
        <CommentModal comment={answer.feedbackComment} onClose={() => setIsCommentModalOpen(false)} />
      )}
    </div>
  );
};

export default AnswerItem;
