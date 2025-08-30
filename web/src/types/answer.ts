// This file defines the types and interfaces related to answers in the application.
// It includes structures for answer data and admin actions.

import { Document } from "langchain/document";

// Possible admin actions that can be taken on an answer
export type AdminAction = "affirmed" | "ignore" | "fixed";

// Main structure for an answer, including metadata and related information
export type Answer = {
  id: string;
  question: string;
  answer: string;
  timestamp: {
    _seconds: number;
    _nanoseconds: number;
  };
  // Optional array of source documents related to the answer
  sources?: Document<Record<string, unknown>>[];
  // Optional vote value, likely for rating the answer
  vote?: number;
  // Optional collection name, useful for multi-collection setups
  collection?: string;
  // Optional IP address of the user who submitted the question
  ip?: string;
  // Number of likes the answer has received
  likeCount: number;
  // Optional admin action taken on this answer
  adminAction?: AdminAction;
  // Timestamp of when the admin action was taken
  adminActionTimestamp?: Timestamp;
  // Optional conversation history leading up to this answer
  history?: { role: string; content: string }[];
  // Optional feedback reason for downvotes
  feedbackReason?: string;
  // Optional feedback comment for downvotes
  feedbackComment?: string;
  // Optional timestamp for feedback submission
  feedbackTimestamp?: Timestamp;
  // Optional AI-generated restated question used for embeddings
  restatedQuestion?: string;
};

// Structure for timestamp data
export interface Timestamp {
  _seconds: number;
  _nanoseconds: number;
}
