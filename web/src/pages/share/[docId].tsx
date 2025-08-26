/**
 * Share conversation route - loads shared conversations directly
 * This handles URLs like /share/[docId] and loads the conversation
 * with proper authentication handling for owners vs non-owners
 */

import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import Layout from "@/components/layout";
import MessageItem from "@/components/MessageItem";
import { SiteConfig } from "@/types/siteConfig";
import { getCommonSiteConfigProps } from "@/utils/server/getCommonSiteConfigProps";
import { loadConversationByDocId } from "@/utils/client/conversationLoader";
import { logEvent } from "@/utils/client/analytics";
import { getGreeting } from "@/utils/client/siteConfig";
import { ExtendedAIMessage } from "@/types/ExtendedAIMessage";
import { DocMetadata } from "@/types/DocMetadata";
import { Document } from "langchain/document";

interface ShareConversationProps {
  siteConfig: SiteConfig | null;
}

export default function ShareConversation({ siteConfig }: ShareConversationProps) {
  const router = useRouter();
  const { docId } = router.query;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ExtendedAIMessage[]>([]);
  const [viewOnlyMode, setViewOnlyMode] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!router.isReady || !docId || typeof docId !== "string") {
      return;
    }

    const loadSharedConversation = async () => {
      try {
        setLoading(true);
        setError(null);

        const loadedConversation = await loadConversationByDocId(docId);

        // If owner, redirect to the full conversation URL
        if (loadedConversation.isOwner && loadedConversation.convId) {
          // Redirect owner to the full conversation URL
          router.replace(`/chat/${loadedConversation.convId}`);
          return;
        }

        // For non-owners, show the shared conversation in read-only mode
        const convertedMessages: ExtendedAIMessage[] = [
          {
            message: getGreeting(siteConfig),
            type: "apiMessage",
          },
          ...loadedConversation.messages.map(
            (msg): ExtendedAIMessage => ({
              type: msg.type,
              message: msg.message,
              sourceDocs: msg.sourceDocs?.filter((doc): doc is Document<DocMetadata> => doc !== null) || undefined,
              docId: msg.docId,
              collection: msg.collection,
            })
          ),
        ];
        setMessages(convertedMessages);

        setViewOnlyMode(loadedConversation.viewOnly);

        // Log analytics event
        logEvent("shared_conversation_loaded", "Sharing", docId, loadedConversation.messages.length);

        // Scroll to last message
        setTimeout(() => {
          if (lastMessageRef.current) {
            lastMessageRef.current.scrollIntoView({ behavior: "smooth" });
          }
        }, 100);
      } catch (error) {
        console.error("Error loading shared conversation:", error);
        setError(error instanceof Error ? error.message : "Failed to load shared conversation");
      } finally {
        setLoading(false);
      }
    };

    loadSharedConversation();
  }, [router.isReady, docId, router, siteConfig]);

  if (loading) {
    return (
      <Layout siteConfig={siteConfig}>
        <div className="flex justify-center items-center h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-600"></div>
          <p className="text-lg text-gray-600 ml-4">Loading shared conversation...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout siteConfig={siteConfig}>
        <div className="flex justify-center items-center h-screen">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4 text-red-600">Error</h1>
            <p className="text-gray-600">{error}</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout siteConfig={siteConfig}>
      <div className="mx-auto w-full max-w-4xl px-4">
        {viewOnlyMode && (
          <div className="bg-blue-100 text-blue-800 text-center py-2 mb-4 rounded-md">
            <span className="material-icons text-sm mr-2">visibility</span>
            You are viewing a shared conversation (read-only)
          </div>
        )}

        <div className="flex-grow overflow-hidden answers-container">
          <div className="h-full overflow-y-auto">
            {messages.map((message, index) => (
              <MessageItem
                key={`sharedMessage-${index}`}
                messageKey={`sharedMessage-${index}`}
                message={message}
                previousMessage={index > 0 ? messages[index - 1] : undefined}
                index={index}
                isLastMessage={index === messages.length - 1}
                loading={false}
                privateSession={false}
                collectionChanged={false}
                hasMultipleCollections={false}
                likeStatuses={{}}
                linkCopied={null}
                votes={{}}
                siteConfig={siteConfig}
                handleLikeCountChange={() => {}}
                handleVote={() => {}}
                handleCopyLink={() => {}}
                lastMessageRef={index === messages.length - 1 ? lastMessageRef : null}
                voteError={null}
                allowAllAnswersPage={siteConfig?.allowAllAnswersPage ?? false}
                showRelatedQuestions={false}
              />
            ))}
            <div ref={lastMessageRef} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

// Fetch initial props for the page
ShareConversation.getInitialProps = async () => {
  const result = await getCommonSiteConfigProps();
  return result.props;
};
