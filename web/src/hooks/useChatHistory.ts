import { useState, useEffect } from "react";
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

  // Fetch conversations grouped by convId
  const fetchConversations = async (loadMore: boolean = false) => {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const uuid = getOrCreateUUID();
      const response = await fetchWithAuth(`/api/chats?uuid=${uuid}&limit=${limit}`, {
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

          // Generate title: use full question if < 7 words, otherwise truncate to 5 words
          const questionWords = lastMessage.question.trim().split(/\s+/);
          const title = questionWords.length < 7 ? lastMessage.question : questionWords.slice(0, 5).join(" ") + "...";

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
      }

      // Check if there are more conversations to load
      setHasMore(chats.length === limit);
    } catch (err) {
      console.error("Error fetching chat history:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch chat history");
    } finally {
      setLoading(false);
    }
  };

  // Load conversations on mount (after main content loads)
  useEffect(() => {
    // Delay initial load to ensure main content loads first
    const timer = setTimeout(() => {
      fetchConversations();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return {
    loading,
    error,
    conversations,
    hasMore,
    fetchConversations,
    refetch: () => fetchConversations(false),
    loadMore: () => fetchConversations(true),
  };
}
