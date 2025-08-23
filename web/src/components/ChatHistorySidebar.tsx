import React from "react";
import { useChatHistory, ConversationGroup } from "@/hooks/useChatHistory";
import { useRouter } from "next/router";
import { logEvent } from "@/utils/client/analytics";

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadConversation?: (convId: string) => void;
}

export default function ChatHistorySidebar({ isOpen, onClose, onLoadConversation }: ChatHistorySidebarProps) {
  const { loading, error, conversations, hasMore, loadMore } = useChatHistory(20);
  const router = useRouter();

  const handleConversationClick = (conversation: ConversationGroup) => {
    // Track conversation click event
    logEvent("chat_history_conversation_click", "Chat History", conversation.convId, conversation.messageCount);

    if (onLoadConversation) {
      // Load conversation into the home page chat interface
      onLoadConversation(conversation.convId);
    } else {
      // Fallback: Navigate to the last message in the conversation
      router.push(`/answers/${conversation.lastMessage.id}`);
      onClose(); // Close sidebar on mobile after navigation
    }
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      // Track load more event
      logEvent("chat_history_load_more", "Chat History", "load_more_conversations", conversations.length);

      loadMore();
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && <div className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden" onClick={onClose} />}

      {/* Sidebar */}
      <div
        className={`
        fixed top-0 left-0 h-full w-72 shadow-lg transform transition-transform duration-300 ease-in-out z-50
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        lg:relative lg:translate-x-0 lg:shadow-none
      `}
        style={{ backgroundColor: "#f8f7f6" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4">
          <h2 className="text-lg font-semibold text-gray-400">Chats</h2>
          <button onClick={onClose} className="lg:hidden p-1 rounded-md hover:bg-gray-100" aria-label="Close sidebar">
            <span className="material-icons text-gray-500">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2"></div>
              Loading conversations...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-red-500">
              <span className="material-icons mb-2">error</span>
              <p className="text-sm">{error}</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <span className="material-icons text-4xl mb-2 text-gray-300">chat_bubble_outline</span>
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs text-gray-400 mt-1">Start a conversation to see your history here</p>
            </div>
          ) : (
            <div className="p-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.convId}
                  onClick={() => handleConversationClick(conversation)}
                  className="w-full text-left p-2 rounded-lg hover:bg-white hover:bg-opacity-60 transition-colors duration-150 mb-1 group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-600">
                      {conversation.title}
                    </p>
                    {conversation.messageCount > 1 && (
                      <p className="text-xs text-gray-500 mt-1">{conversation.messageCount} messages</p>
                    )}
                  </div>
                </button>
              ))}

              {/* Load more button */}
              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="w-full p-3 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-blue-200 hover:border-blue-300 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                      Loading...
                    </div>
                  ) : (
                    "Load more conversations"
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
