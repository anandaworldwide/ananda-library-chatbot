/**
 * Chat history utilities for converting between different formats
 * This file contains shared types and conversion functions used across the application
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatHistory =
  | ChatMessage[] // Preferred format: role-based objects
  | undefined;

/**
 * Converts ChatMessage[] format to string format for LangChain templates.
 * Returns a formatted string representation of the conversation.
 */
export function convertChatHistory(history: ChatHistory): string {
  if (!history || !Array.isArray(history)) return "";

  return history
    .map((message) => {
      const role = message.role === "user" ? "Human" : "Assistant";
      return `${role}: ${message.content}`;
    })
    .join("\n");
}

/**
 * Converts ChatMessage[] format to string format for LangChain templates.
 * Same as convertChatHistory - kept for backward compatibility.
 */
export function convertChatHistoryToString(history: ChatHistory): string {
  return convertChatHistory(history);
}

/**
 * Creates a role-based chat history from input and output strings
 */
export function createChatMessages(userInput: string, assistantOutput: string): ChatMessage[] {
  return [
    { role: "user", content: userInput },
    { role: "assistant", content: assistantOutput },
  ];
}
