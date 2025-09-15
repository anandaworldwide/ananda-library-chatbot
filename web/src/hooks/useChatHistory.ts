import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/utils/client/tokenManager";
import { getOrCreateUUID } from "@/utils/client/uuid";

export interface ChatHistoryItem {
  id: string;
  question: string;
  answer: string;
  timestamp: any; // Firestore timestamp

  collection: string;
  convId?: string;
  title?: string; // AI-generated title
  sources?: string; // JSON string of source documents
  suggestions?: string[]; // Follow-up question suggestions
  restatedQuestion?: string; // AI-generated restated question for better context
  isStarred?: boolean; // Star state for this conversation
}

export interface ConversationGroup {
  convId: string;
  title: string; // AI-generated title or truncated question
  lastMessage: ChatHistoryItem;
  messageCount: number;
  isStarred?: boolean; // Star state for this conversation
}

export function useChatHistory(limit: number = 20) {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationGroup[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(true);

  // Separate state for starred conversations
  const [starredConversations, setStarredConversations] = useState<ConversationGroup[]>([]);
  const [starredHasMore, setStarredHasMore] = useState<boolean>(false);
  const [starredNextCursor, setStarredNextCursor] = useState<string | null>(null);
  const [starredLoading, setStarredLoading] = useState<boolean>(false);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);

  // Fetch conversations grouped by convId
  const fetchConversations = useCallback(
    async (loadMore: boolean = false) => {
      if (loading) return;

      setLoading(true);
      setError(null);

      try {
        const uuid = getOrCreateUUID();

        // Build URL with pagination cursor for "load more"
        // Use a higher limit to ensure we get enough messages to group into the desired number of conversations
        const messageLimit = Math.max(limit * 3, 50); // Fetch at least 3x the conversation limit or 50, whichever is higher
        let url = `/api/chats?uuid=${uuid}&limit=${messageLimit}`;
        if (loadMore && lastTimestamp) {
          url += `&startAfter=${encodeURIComponent(lastTimestamp)}`;
        }

        const response = await fetchWithAuth(url, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const chats: ChatHistoryItem[] = await response.json();

        // Group chats by convId
        const conversationMap = new Map<string, ChatHistoryItem[]>();

        chats.forEach((chat) => {
          const convId = chat.convId || chat.id; // Fallback to docId for legacy docs
          if (!conversationMap.has(convId)) {
            conversationMap.set(convId, []);
          }
          conversationMap.get(convId)!.push(chat);
        });

        // Convert to ConversationGroup array
        const groupedConversations: ConversationGroup[] = Array.from(conversationMap.entries()).map(
          ([convId, messages]) => {
            // Sort messages by timestamp (newest first)
            const sortedMessages = messages.sort((a, b) => {
              const timeA = a.timestamp?.seconds || a.timestamp?._seconds || 0;
              const timeB = b.timestamp?.seconds || b.timestamp?._seconds || 0;
              return timeB - timeA;
            });

            const lastMessage = sortedMessages[0];

            // Use title from the FIRST message (chronologically) to maintain conversation title consistency
            // Sort messages by timestamp (oldest first) to find the first message
            const firstMessage = messages.sort((a, b) => {
              const timeA = a.timestamp?.seconds || a.timestamp?._seconds || 0;
              const timeB = b.timestamp?.seconds || b.timestamp?._seconds || 0;
              return timeA - timeB;
            })[0];

            // Use AI-generated title from first message if available, otherwise generate fallback title
            let title = firstMessage.title;
            if (!title) {
              // Fallback: use full question if < 5 words, otherwise truncate to 4 words (using first message)
              const questionWords = firstMessage.question.trim().split(/\s+/);
              title = questionWords.length <= 5 ? firstMessage.question : questionWords.slice(0, 4).join(" ") + "...";
            }

            return {
              convId,
              title,
              lastMessage,
              messageCount: messages.length,
              isStarred: firstMessage.isStarred || false, // Star state from first message
            };
          }
        );

        // Sort conversations by last message timestamp (newest first)
        groupedConversations.sort((a, b) => {
          const timeA = a.lastMessage.timestamp?.seconds || a.lastMessage.timestamp?._seconds || 0;
          const timeB = b.lastMessage.timestamp?.seconds || b.lastMessage.timestamp?._seconds || 0;
          return timeB - timeA;
        });

        if (loadMore) {
          setConversations((prev) => [...prev, ...groupedConversations]);
        } else {
          setConversations(groupedConversations);
          // Reset pagination cursor on initial load
          setLastTimestamp(null);
        }

        // Update pagination cursor with the timestamp of the last chat
        if (chats.length > 0) {
          const lastChat = chats[chats.length - 1];
          const timestamp = lastChat.timestamp;

          // Convert Firestore timestamp to ISO string for API
          let timestampString: string;
          if (timestamp?.seconds) {
            // Firestore timestamp format
            timestampString = new Date(timestamp.seconds * 1000).toISOString();
          } else if (timestamp?._seconds) {
            // Alternative Firestore timestamp format
            timestampString = new Date(timestamp._seconds * 1000).toISOString();
          } else if (timestamp instanceof Date) {
            timestampString = timestamp.toISOString();
          } else {
            timestampString = new Date(timestamp).toISOString();
          }

          setLastTimestamp(timestampString);
        }

        // Check if there are more conversations to load
        // We fetched more messages than the conversation limit, so if we got exactly the message limit,
        // there are likely more messages (and thus conversations) available
        setHasMore(chats.length === messageLimit);
      } catch (err) {
        console.error("Error fetching chat history:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch chat history");
      } finally {
        setLoading(false);
      }
    },
    [loading, limit, lastTimestamp]
  );

  // Load conversations on mount (after main content loads)
  useEffect(() => {
    // Delay initial load to ensure main content loads first
    const timer = setTimeout(() => {
      fetchConversations();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // Function to add a new conversation to the top of the list
  const addNewConversation = useCallback((convId: string, title: string, question: string) => {
    const newConversation: ConversationGroup = {
      convId,
      title,
      lastMessage: {
        id: `temp_${convId}`,
        question,
        answer: "", // Will be populated when response comes
        timestamp: { seconds: Math.floor(Date.now() / 1000) }, // Current timestamp

        collection: "",
        convId,
        title,
      },
      messageCount: 1,
    };

    // Add to the top of the conversations list and remove duplicates
    setConversations((prev) => {
      // Remove any existing conversation with the same convId to prevent duplicates
      const filtered = prev.filter((conv) => conv.convId !== convId);
      return [newConversation, ...filtered];
    });
  }, []);

  // Function to update an existing conversation's title
  const updateConversationTitle = useCallback((convId: string, newTitle: string) => {
    setConversations((prev) => prev.map((conv) => (conv.convId === convId ? { ...conv, title: newTitle } : conv)));
  }, []);

  // Function to rename a conversation
  const renameConversation = useCallback(
    async (convId: string, newTitle: string) => {
      const response = await fetchWithAuth(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to rename conversation");
      }

      // Update local state
      updateConversationTitle(convId, newTitle);

      return await response.json();
    },
    [updateConversationTitle]
  );

  // Function to delete a conversation
  const deleteConversation = useCallback(async (convId: string) => {
    const response = await fetchWithAuth(`/api/conversations/${convId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to delete conversation");
    }

    // Remove from local state
    setConversations((prev) => prev.filter((conv) => conv.convId !== convId));

    return await response.json();
  }, []);

  // Fetch starred conversations with pagination
  const fetchStarredConversations = useCallback(
    async (loadMore: boolean = false) => {
      try {
        setStarredLoading(true);

        const uuid = getOrCreateUUID();
        // Use same limit calculation as regular conversations for consistency
        const messageLimit = Math.max(limit * 3, 50);
        const params = new URLSearchParams({
          uuid: uuid,
          limit: messageLimit.toString(),
          starred: "true", // Use existing /api/chats endpoint with starred filter
        });

        if (loadMore && starredNextCursor) {
          params.append("startAfter", starredNextCursor);
        }

        const response = await fetchWithAuth(`/api/chats?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch starred conversations: ${response.status}`);
        }

        const chats: ChatHistoryItem[] = await response.json();

        // Group chats by convId (same logic as regular fetchConversations)
        const conversationMap = new Map<string, ChatHistoryItem[]>();

        chats.forEach((chat) => {
          const convId = chat.convId || chat.id; // Fallback to docId for legacy docs
          if (!conversationMap.has(convId)) {
            conversationMap.set(convId, []);
          }
          conversationMap.get(convId)!.push(chat);
        });

        // Convert to ConversationGroup array
        const groupedConversations: ConversationGroup[] = Array.from(conversationMap.entries()).map(
          ([convId, messages]) => {
            // Sort messages by timestamp (newest first)
            const sortedMessages = messages.sort((a, b) => {
              const timeA = a.timestamp?.seconds || a.timestamp?._seconds || 0;
              const timeB = b.timestamp?.seconds || b.timestamp?._seconds || 0;
              return timeB - timeA;
            });

            const lastMessage = sortedMessages[0];

            // Use title from the FIRST message (chronologically) to maintain conversation title consistency
            // Sort messages by timestamp (oldest first) to find the first message
            const firstMessage = messages.sort((a, b) => {
              const timeA = a.timestamp?.seconds || a.timestamp?._seconds || 0;
              const timeB = b.timestamp?.seconds || b.timestamp?._seconds || 0;
              return timeA - timeB;
            })[0];

            // Use AI-generated title from first message if available, otherwise generate fallback title
            let title = firstMessage.title;
            if (!title) {
              // Fallback: use full question if < 5 words, otherwise truncate to 4 words (using first message)
              const questionWords = firstMessage.question.trim().split(/\s+/);
              title = questionWords.length <= 5 ? firstMessage.question : questionWords.slice(0, 4).join(" ") + "...";
            }

            return {
              convId,
              title,
              lastMessage,
              messageCount: messages.length,
              isStarred: firstMessage.isStarred || false, // Star state from first message
            };
          }
        );

        // Sort conversations by last message timestamp (newest first)
        groupedConversations.sort((a, b) => {
          const timeA = a.lastMessage.timestamp?.seconds || a.lastMessage.timestamp?._seconds || 0;
          const timeB = b.lastMessage.timestamp?.seconds || b.lastMessage.timestamp?._seconds || 0;
          return timeB - timeA;
        });

        if (loadMore) {
          setStarredConversations((prev) => [...prev, ...groupedConversations]);
        } else {
          setStarredConversations(groupedConversations);
        }

        // Update pagination cursor with the timestamp of the last chat
        if (chats.length > 0) {
          const lastChat = chats[chats.length - 1];
          const timestamp = lastChat.timestamp;

          // Convert Firestore timestamp to ISO string for API
          let timestampString: string;
          if (timestamp?.seconds) {
            // Firestore timestamp format
            timestampString = new Date(timestamp.seconds * 1000).toISOString();
          } else if (timestamp?._seconds) {
            // Alternative Firestore timestamp format
            timestampString = new Date(timestamp._seconds * 1000).toISOString();
          } else if (timestamp instanceof Date) {
            timestampString = timestamp.toISOString();
          } else {
            timestampString = new Date(timestamp).toISOString();
          }

          setStarredNextCursor(timestampString);
        }

        // Check if there are more conversations to load
        // We fetched more messages than the conversation limit, so if we got exactly the message limit,
        // there are likely more messages (and thus conversations) available
        setStarredHasMore(chats.length === messageLimit);
      } catch (error: any) {
        console.error("Error fetching starred conversations:", error);
        setError(error.message);
      } finally {
        setStarredLoading(false);
      }
    },
    [limit, starredNextCursor]
  );

  const refetch = useCallback(() => fetchConversations(false), [fetchConversations]);
  const loadMore = useCallback(() => fetchConversations(true), [fetchConversations]);
  const loadMoreStarred = useCallback(() => fetchStarredConversations(true), [fetchStarredConversations]);
  const refetchStarred = useCallback(() => fetchStarredConversations(false), [fetchStarredConversations]);

  // Star/unstar conversation
  const starConversation = useCallback(
    async (convId: string) => {
      try {
        const response = await fetchWithAuth("/api/conversations/star", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            convId,
            action: "star",
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to star conversation");
        }

        // Update local state
        setConversations((prevConversations) =>
          prevConversations.map((conv) => (conv.convId === convId ? { ...conv, isStarred: true } : conv))
        );

        // Add to starred conversations if not already there
        setStarredConversations((prev) => {
          // Check if already in starred list
          if (prev.find((conv) => conv.convId === convId)) {
            return prev;
          }

          // Find the conversation in the current conversations state
          const starredConv = conversations.find((conv) => conv.convId === convId);
          if (starredConv) {
            return [{ ...starredConv, isStarred: true }, ...prev];
          }

          return prev;
        });
      } catch (error) {
        console.error("Failed to star conversation:", error);
        throw error;
      }
    },
    [conversations, starredConversations]
  );

  const unstarConversation = useCallback(async (convId: string) => {
    try {
      const response = await fetchWithAuth("/api/conversations/star", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          convId,
          action: "unstar",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to unstar conversation");
      }

      // Update local state
      setConversations((prevConversations) =>
        prevConversations.map((conv) => (conv.convId === convId ? { ...conv, isStarred: false } : conv))
      );

      // Remove from starred conversations
      setStarredConversations((prev) => prev.filter((conv) => conv.convId !== convId));
    } catch (error) {
      console.error("Failed to unstar conversation:", error);
      throw error;
    }
  }, []);

  return {
    loading,
    error,
    conversations,
    hasMore,
    fetchConversations,
    refetch,
    loadMore,
    addNewConversation,
    updateConversationTitle,
    renameConversation,
    deleteConversation,
    starConversation,
    unstarConversation,
    // Starred conversations state
    starredConversations,
    starredHasMore,
    starredLoading,
    fetchStarredConversations,
    refetchStarred,
    loadMoreStarred,
  };
}
