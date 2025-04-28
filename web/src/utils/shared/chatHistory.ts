/**
 * Chat history utilities for converting between different formats
 * This file contains shared types and conversion functions used across the application
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatHistory =
  | ChatMessage[] // Preferred format: role-based objects
  | undefined;

/**
 * Converts ChatMessage[] format to the format needed for the LLM prompt.
 * Returns a formatted string with Human/Assistant prefixes.
 */
export function convertChatHistory(history: ChatHistory): string {
  if (!history) return '';

  if (
    Array.isArray(history) &&
    history.length > 0 &&
    typeof history[0] === 'object' &&
    'role' in history[0]
  ) {
    // Pair up user and assistant messages
    let formattedHistory = '';
    for (let i = 0; i < history.length; i += 2) {
      if (i + 1 >= history.length) break; // Skip incomplete pairs

      const userMessage = history[i] as ChatMessage;
      const assistantMessage = history[i + 1] as ChatMessage;

      // Check if we have a valid user-assistant pair
      if (
        userMessage?.role === 'user' &&
        assistantMessage?.role === 'assistant'
      ) {
        formattedHistory += `Human: ${userMessage.content}\nAssistant: ${assistantMessage.content}\n`;
      }
    }
    return formattedHistory.trim();
  }

  return '';
}

/**
 * Creates a role-based chat history from input and output strings
 */
export function createChatMessages(
  userInput: string,
  assistantOutput: string,
): ChatMessage[] {
  return [
    { role: 'user', content: userInput },
    { role: 'assistant', content: assistantOutput },
  ];
}
