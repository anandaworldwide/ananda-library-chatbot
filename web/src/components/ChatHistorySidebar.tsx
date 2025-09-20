import React, { useCallback, useEffect, useState } from "react";
import { useChatHistory, ConversationGroup } from "@/hooks/useChatHistory";
import { useRouter } from "next/router";
import { logEvent } from "@/utils/client/analytics";
import ConversationMenu from "./ConversationMenu";
import RenameConversationModal from "./RenameConversationModal";
import DeleteConversationModal from "./DeleteConversationModal";
import StarButton from "./StarButton";

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
  onConversationDeleted?: (deletedConvId: string) => void;
}

export default function ChatHistorySidebar({
  isOpen,
  onClose,
  onLoadConversation,
  currentConvId,
  onGetSidebarFunctions,
  onConversationDeleted,
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
    starConversation,
    unstarConversation,
    // Starred conversations state
    starredConversations,
    starredHasMore,
    starredLoading,
    fetchStarredConversations,
    loadMoreStarred,
  } = useChatHistory(20);
  const router = useRouter();

  // Filter state
  const [filterMode, setFilterMode] = useState<"all" | "starred">("all");

  // Track whether we've attempted to load starred conversations
  const [starredAttempted, setStarredAttempted] = useState<boolean>(false);

  // Track delayed loading state for starred conversations (show spinner only after 3 seconds)
  const [showStarredSpinner, setShowStarredSpinner] = useState<boolean>(false);

  // Loading state for filter mode changes to prevent empty state flash

  // Memoized boolean for cleaner conditions and to avoid TypeScript unreachable-branch lint
  const isStarredMode = filterMode === "starred";

  // Fetch appropriate conversations when switching modes
  useEffect(() => {
    if (isStarredMode && starredConversations.length === 0) {
      // Fetch starred conversations in background
      fetchStarredConversations(false);
      setStarredAttempted(true);
    }
  }, [isStarredMode, starredConversations.length, fetchStarredConversations]);

  // Handle delayed spinner for starred mode (show spinner only after 3 seconds)
  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (isStarredMode && !starredAttempted) {
      // Start 3-second timer to show spinner
      timer = setTimeout(() => {
        setShowStarredSpinner(true);
      }, 3000);
    } else {
      // Reset spinner state when not in starred mode or when attempt is complete
      setShowStarredSpinner(false);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isStarredMode, starredAttempted]);

  // Handle filter mode changes to refresh data when needed
  const handleFilterModeChange = useCallback(
    (newMode: "all" | "starred") => {
      setFilterMode(newMode);

      // Track filter toggle usage
      logEvent(
        "conversation_filter_toggle",
        "Conversation Management",
        `Switch to ${newMode}`,
        newMode === "starred" ? 1 : 0
      );

      // Refresh data when switching modes to ensure star states are current
      // Use silent mode to avoid showing loading spinners for quick toggles
      if (newMode === "all") {
        refetch(); // Refresh regular conversations
        setStarredAttempted(false); // Reset starred attempted flag
        setShowStarredSpinner(false); // Reset spinner state
      } else {
        // Always refetch starred conversations to get current state
        fetchStarredConversations(false);
        setStarredAttempted(true);
        setShowStarredSpinner(false); // Reset spinner state since we're loading silently
      }
    },
    [refetch, fetchStarredConversations]
  );

  // Use appropriate conversation list based on filter mode
  const displayConversations = isStarredMode ? starredConversations : conversations;
  const displayHasMore = isStarredMode ? starredHasMore : hasMore;
  const displayLoading = isStarredMode ? starredLoading : loading;
  const displayLoadMore = isStarredMode ? loadMoreStarred : loadMore;

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

      // If the deleted conversation is currently being viewed, notify parent to clear chat
      if (deleteModal.convId === currentConvId && onConversationDeleted) {
        onConversationDeleted(deleteModal.convId);
        onClose(); // Close sidebar on mobile after navigation
      }
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
      {isOpen && <div className="fixed inset-0 bg-black bg-opacity-25 z-30 lg:hidden" onClick={onClose} />}

      {/* Sidebar */}
      <div
        className={`
        fixed top-[68px] left-0 h-[calc(100vh-68px)] w-72 shadow-lg transform transition-transform duration-300 ease-in-out z-40
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        lg:relative lg:top-0 lg:h-full lg:translate-x-0 lg:shadow-none
      `}
        style={{ backgroundColor: "#fffbee" }}
      >
        {/* Header */}
        <div className="relative px-[35px] pt-4 pb-2">
          <div className="flex items-center justify-between">
            <h2
              className="text-[18px] font-bold text-black text-opacity-70"
              style={{ fontFamily: "'Open Sans', sans-serif" }}
            >
              Chats
            </h2>
            <button onClick={onClose} className="lg:hidden p-1 rounded-md hover:bg-gray-100" aria-label="Close sidebar">
              <span className="material-icons text-gray-500">close</span>
            </button>
          </div>
          {/* Filter toggle positioned further right to avoid three-dot menu overlap */}
          <div className="absolute right-8 top-4">
            <button
              onClick={() => handleFilterModeChange(filterMode === "all" ? "starred" : "all")}
              className={`px-2 py-1 text-xs rounded-md transition-colors duration-200 ${
                filterMode === "starred"
                  ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              title={filterMode === "all" ? "Show starred conversations only" : "Show all conversations"}
            >
              {filterMode === "all" ? "☆ All Chats" : "★ Starred Only"}
            </button>
          </div>
        </div>

        {/* Content - Fixed height with independent scrolling */}
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
          ) : displayConversations.length === 0 ? (
            // Show loading spinner if we're loading regular conversations, or if we're in starred mode and should show delayed spinner
            displayLoading || (isStarredMode && showStarredSpinner) ? (
              <div className="p-4 text-center text-gray-500">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2" />
                Loading conversations...
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500">
                <span className="material-icons text-4xl mb-2 text-gray-300">
                  {isStarredMode ? "star_border" : "chat_bubble_outline"}
                </span>
                <p className="text-sm">
                  {isStarredMode
                    ? "Star conversations to see them here"
                    : "Start a conversation to see your history here"}
                </p>
              </div>
            )
          ) : (
            <div className="py-2">
              {displayConversations.map((conversation) => {
                const isCurrentConversation = currentConvId === conversation.convId;
                return (
                  <div
                    key={conversation.convId}
                    className={`relative transition-colors duration-150 mb-1 group cursor-pointer px-[35px] ${
                      isCurrentConversation ? "shadow-sm" : "lg:hover:bg-yellow-100 lg:hover:bg-opacity-80"
                    }`}
                    style={undefined}
                  >
                    <div className="flex items-center py-2 relative">
                      {/* Star button positioned in left margin */}
                      <div className="absolute -left-6 flex-shrink-0">
                        <StarButton
                          convId={conversation.convId}
                          isStarred={conversation.isStarred || false}
                          onStarChange={async (convId, isStarred) => {
                            if (isStarred) {
                              await starConversation(convId);
                            } else {
                              await unstarConversation(convId);
                            }
                          }}
                          size="sm"
                        />
                      </div>

                      {/* Title area (clickable) - aligned exactly with "Chats" header */}
                      <button
                        onClick={() => handleConversationClick(conversation)}
                        className="flex-1 text-left rounded-lg pr-3"
                      >
                        <div className="min-w-0">
                          <p
                            className={`text-[14px] ${
                              isCurrentConversation
                                ? "font-bold text-black text-opacity-70"
                                : "font-normal text-black text-opacity-70"
                            }`}
                            style={{ fontFamily: "'Open Sans', sans-serif" }}
                          >
                            {conversation.title}
                          </p>
                        </div>
                      </button>

                      {/* Three-dot menu positioned in right margin */}
                      <div className="absolute -right-4 flex-shrink-0">
                        <ConversationMenu
                          isVisible={true}
                          isRowSelected={isCurrentConversation}
                          onRename={() => handleRename(conversation)}
                          onDelete={() => handleDelete(conversation)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Load more button */}
              {displayHasMore && (
                <button
                  onClick={displayLoadMore}
                  disabled={displayLoading}
                  className="w-full p-3 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-blue-200 hover:border-blue-300 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {displayLoading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                      Loading...
                    </div>
                  ) : isStarredMode ? (
                    "Load more starred conversations"
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
