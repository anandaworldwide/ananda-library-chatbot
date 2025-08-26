/**
 * Conversation Loading Utility
 *
 * Loads full conversations by convId and transforms them for the chat interface
 */

import { fetchWithAuth } from "@/utils/client/tokenManager";
import { getOrCreateUUID } from "@/utils/client/uuid";
import { Message } from "@/types/chat";
import { ChatMessage, createChatMessages } from "@/utils/shared/chatHistory";
import { ChatHistoryItem } from "@/hooks/useChatHistory";
import { Document } from "langchain/document";

export interface LoadedConversation {
  messages: Message[];
  history: ChatMessage[];
  title?: string;
  convId?: string;
}

/**
 * Loads a full conversation by convId and transforms it for the chat interface
 */
export async function loadConversationByConvId(
  convId: string,
  upToTimestamp?: any,
  uuidOverride?: string
): Promise<LoadedConversation> {
  try {
    const uuid = uuidOverride || getOrCreateUUID();

    // Fetch all messages in the conversation
    const response = await fetchWithAuth(`/api/chats?uuid=${encodeURIComponent(uuid)}&convId=${convId}&limit=200`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const chats: ChatHistoryItem[] = await response.json();

    if (chats.length === 0) {
      throw new Error("Conversation not found");
    }

    // Sort chats by timestamp (oldest first for proper conversation flow)
    let sortedChats = chats.sort((a, b) => {
      const timeA = a.timestamp?.seconds || a.timestamp?._seconds || 0;
      const timeB = b.timestamp?.seconds || b.timestamp?._seconds || 0;
      return timeA - timeB;
    });

    // Filter chats up to the specified timestamp if provided
    if (upToTimestamp) {
      const upToTime = upToTimestamp.seconds || upToTimestamp._seconds || upToTimestamp;
      sortedChats = sortedChats.filter((chat) => {
        const chatTime = chat.timestamp?.seconds || chat.timestamp?._seconds || 0;
        return chatTime <= upToTime;
      });
    }

    // Transform chats into Message[] format for the chat interface
    const messages: Message[] = [];
    const history: ChatMessage[] = [];

    // Add greeting message first (this is typically the first message in the chat interface)
    // We'll let the calling component handle the greeting since it's site-specific

    // Process each chat item
    sortedChats.forEach((chat) => {
      // Add user message
      messages.push({
        type: "userMessage",
        message: chat.question,
      });

      // Add assistant message
      const sourceDocs: Document[] = [];
      try {
        if (chat.sources) {
          const parsedSources = typeof chat.sources === "string" ? JSON.parse(chat.sources) : chat.sources;

          if (Array.isArray(parsedSources)) {
            sourceDocs.push(
              ...parsedSources.map((doc: any) => ({
                ...doc,
                metadata: {
                  ...doc.metadata,
                  title: doc.metadata?.title || "Unknown source",
                },
              }))
            );
          }
        }
      } catch (error) {
        console.warn("Failed to parse sources for chat:", chat.id, error);
      }

      messages.push({
        type: "apiMessage",
        message: chat.answer,
        sourceDocs: sourceDocs.length > 0 ? sourceDocs : undefined,
        docId: chat.id,
        collection: chat.collection,
      });

      // Add to history for continuation
      history.push(...createChatMessages(chat.question, chat.answer));
    });

    // Get title from the first chat chronologically (which should have the AI-generated title)
    // Sort by timestamp (oldest first) to get the actual first message
    const firstChat = sortedChats.sort((a, b) => {
      const timeA = a.timestamp?.seconds || a.timestamp?._seconds || 0;
      const timeB = b.timestamp?.seconds || b.timestamp?._seconds || 0;
      return timeA - timeB;
    })[0];

    const title = firstChat?.title;

    return {
      messages,
      history,
      title,
      convId,
    };
  } catch (error) {
    console.error("Error loading conversation:", error);
    throw error;
  }
}

/**
 * Loads conversation by document ID with ownership and timestamp logic
 */
export async function loadConversationByDocId(
  docId: string
): Promise<LoadedConversation & { isOwner: boolean; viewOnly: boolean }> {
  try {
    // First fetch the document to get convId and ownership info
    const docResponse = await fetch(`/api/document/${docId}`);

    if (!docResponse.ok) {
      if (docResponse.status === 404) {
        throw new Error("Document not found");
      }
      throw new Error(`Failed to fetch document: ${docResponse.statusText}`);
    }

    const docData = await docResponse.json();
    const { convId, uuid: docUuid, timestamp } = docData;

    const currentUuid = getOrCreateUUID();
    const isOwner = currentUuid === docUuid;

    // Load conversation - full if owner, up to timestamp if not
    const conversation = await loadConversationByConvId(
      convId,
      isOwner ? undefined : timestamp,
      isOwner ? undefined : docUuid
    );

    return {
      ...conversation,
      convId, // Include the convId from the document data
      isOwner,
      viewOnly: !isOwner,
    };
  } catch (error) {
    console.error("Error loading conversation by doc ID:", error);
    throw error;
  }
}
