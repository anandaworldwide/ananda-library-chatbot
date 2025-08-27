import React, { useEffect, useState } from "react";
import { useChatHistory, ConversationGroup } from "@/hooks/useChatHistory";
import { useRouter } from "next/router";
import { logEvent } from "@/utils/client/analytics";
import ConversationMenu from "./ConversationMenu";
import RenameConversationModal from "./RenameConversationModal";
import DeleteConversationModal from "./DeleteConversationModal";

export type SidebarRefetch = () => void;

export interface SidebarFunctions {
  addNewConversation: (convId: string, title: string, question: string) => void;
  updateConversationTitle: (convId: string, newTitle: string) => void;
}

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadConversation?: (convId: string) => void;
  currentConvId?: string | null;
  onGetSidebarFunctions?: (functions: SidebarFunctions, refetch: () => void) => void;
}

export default function ChatHistorySidebar({
  isOpen,
  onClose,
  onLoadConversation,
  currentConvId,
  onGetSidebarFunctions,
}: ChatHistorySidebarProps) {
  const {
    loading,
    error,
    conversations,
    hasMore,
    loadMore,
    addNewConversation,
    updateConversationTitle,
    refetch,
    renameConversation,
    deleteConversation,
  } = useChatHistory(20);
  const router = useRouter();

  // Modal states
  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    convId: string;
    currentTitle: string;
  }>({
    isOpen: false,
    convId: "",
    currentTitle: "",
  });

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    convId: string;
    title: string;
  }>({
    isOpen: false,
    convId: "",
    title: "",
  });

  const [operationLoading, setOperationLoading] = useState(false);

  // Expose functions to parent
  useEffect(() => {
    if (onGetSidebarFunctions) {
      onGetSidebarFunctions(
        {
          addNewConversation,
          updateConversationTitle,
        },
        refetch
      );
    }
  }, [onGetSidebarFunctions, addNewConversation, updateConversationTitle, refetch]);

  const handleConversationClick = (conversation: ConversationGroup) => {
    // Track conversation click event
    logEvent("chat_history_conversation_click", "Chat History", conversation.convId, conversation.messageCount);

    if (onLoadConversation) {
      // Load conversation into the home page chat interface
      onLoadConversation(conversation.convId);
    } else {
      // Fallback: Navigate to the conversation using new chat URL format
      router.push(`/chat/${conversation.convId}`);
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

  // Handle rename conversation
  const handleRename = (conversation: ConversationGroup) => {
    setRenameModal({
      isOpen: true,
      convId: conversation.convId,
      currentTitle: conversation.title,
    });
  };

  const handleRenameSubmit = async (newTitle: string) => {
    setOperationLoading(true);
    try {
      await renameConversation(renameModal.convId, newTitle);

      // Track rename event
      logEvent("chat_history_conversation_rename", "Chat History", renameModal.convId, newTitle.length);
    } catch (error) {
      console.error("Failed to rename conversation:", error);
      throw error; // Re-throw to let modal handle the error display
    } finally {
      setOperationLoading(false);
    }
  };

  const handleRenameClose = () => {
    if (!operationLoading) {
      setRenameModal({ isOpen: false, convId: "", currentTitle: "" });
    }
  };

  // Handle delete conversation
  const handleDelete = (conversation: ConversationGroup) => {
    setDeleteModal({
      isOpen: true,
      convId: conversation.convId,
      title: conversation.title,
    });
  };

  const handleDeleteConfirm = async () => {
    setOperationLoading(true);
    try {
      await deleteConversation(deleteModal.convId);

      // Track delete event
      logEvent("chat_history_conversation_delete", "Chat History", deleteModal.convId, 1);
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      throw error; // Re-throw to let modal handle the error display
    } finally {
      setOperationLoading(false);
    }
  };

  const handleDeleteClose = () => {
    if (!operationLoading) {
      setDeleteModal({ isOpen: false, convId: "", title: "" });
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
              {conversations.map((conversation) => {
                const isCurrentConversation = currentConvId === conversation.convId;
                return (
                  <div
                    key={conversation.convId}
                    className={`relative rounded-lg transition-colors duration-150 mb-1 group ${
                      isCurrentConversation ? "bg-white bg-opacity-80 shadow-sm" : "hover:bg-white hover:bg-opacity-60"
                    }`}
                  >
                    <button
                      onClick={() => handleConversationClick(conversation)}
                      className="w-full text-left p-2 pr-8 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isCurrentConversation ? "text-blue-700" : "text-gray-900 group-hover:text-blue-600"
                          }`}
                        >
                          {conversation.title}
                        </p>
                      </div>
                    </button>

                    {/* Three-dot menu */}
                    <div className="absolute right-2 top-2">
                      <ConversationMenu
                        isVisible={true}
                        onRename={() => handleRename(conversation)}
                        onDelete={() => handleDelete(conversation)}
                      />
                    </div>
                  </div>
                );
              })}

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

      {/* Rename Modal */}
      <RenameConversationModal
        isOpen={renameModal.isOpen}
        onClose={handleRenameClose}
        onSave={handleRenameSubmit}
        currentTitle={renameModal.currentTitle}
        isLoading={operationLoading}
      />

      {/* Delete Modal */}
      <DeleteConversationModal
        isOpen={deleteModal.isOpen}
        onClose={handleDeleteClose}
        onConfirm={handleDeleteConfirm}
        conversationTitle={deleteModal.title}
        isLoading={operationLoading}
      />
    </>
  );
}
