import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/utils/client/tokenManager";
import { getOrCreateUUID } from "@/utils/client/uuid";

export interface ChatHistoryItem {
  id: string;
  question: string;
  answer: string;
  timestamp: any; // Firestore timestamp
  likeCount: number;
  collection: string;
  convId?: string;
  title?: string; // AI-generated title
  sources?: string; // JSON string of source documents
}

export interface ConversationGroup {
  convId: string;
  title: string; // AI-generated title or truncated question
  lastMessage: ChatHistoryItem;
  messageCount: number;
}

export function useChatHistory(limit: number = 20) {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationGroup[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(true);
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
        let url = `/api/chats?uuid=${uuid}&limit=${limit}`;
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
        setHasMore(chats.length === limit);
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
        likeCount: 0,
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

  const refetch = useCallback(() => fetchConversations(false), [fetchConversations]);
  const loadMore = useCallback(() => fetchConversations(true), [fetchConversations]);

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
  };
}
