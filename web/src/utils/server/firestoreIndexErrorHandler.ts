/**
 * Centralized handler for Firestore index-related errors
 * Provides consistent error detection, user-friendly messages, and ops notifications
 */

import { sendOpsAlert } from "./emailOps";

export interface FirestoreIndexError {
  isIndexError: boolean;
  isBuilding: boolean;
  userMessage: string;
  adminMessage: string;
  indexUrl?: string;
  shouldNotifyOps: boolean;
}

/**
 * Detects if an error is related to Firestore indexes and extracts relevant information
 */
export function analyzeFirestoreError(error: unknown): FirestoreIndexError {
  const errorMessage = error instanceof Error ? error.message : String(error);

  const isIndexError =
    errorMessage.includes("query requires an index") ||
    errorMessage.includes("index is currently building") ||
    errorMessage.includes("The query requires an index") ||
    errorMessage.includes("indexes");

  if (!isIndexError) {
    return {
      isIndexError: false,
      isBuilding: false,
      userMessage: "",
      adminMessage: "",
      shouldNotifyOps: false,
    };
  }

  const isBuilding = errorMessage.includes("index is currently building");

  // Extract Firebase Console URL from error message if available
  const urlMatch = errorMessage.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
  const indexUrl = urlMatch ? urlMatch[0] : undefined;

  const userMessage = isBuilding
    ? "The database is currently being optimized. Please try again in a few minutes. If this persists, please contact the site administrator."
    : "This feature requires database configuration. Please contact the site administrator to enable this functionality.";

  const adminMessage = isBuilding
    ? "Firestore index is currently building. This is normal for new indexes and should resolve automatically."
    : "Firestore index is missing and needs to be created. Check the Firebase Console to create the required index.";

  return {
    isIndexError: true,
    isBuilding,
    userMessage,
    adminMessage,
    indexUrl,
    shouldNotifyOps: !isBuilding, // Only notify for missing indexes, not building ones
  };
}

/**
 * Sends ops alert for Firestore index errors
 */
export async function notifyOpsOfIndexError(
  error: unknown,
  context: {
    endpoint: string;
    collection?: string;
    fields?: string[];
    query?: string;
  }
): Promise<void> {
  const analysis = analyzeFirestoreError(error);

  if (!analysis.shouldNotifyOps) {
    return; // Don't spam ops for building indexes
  }

  const errorMessage = error instanceof Error ? error.message : String(error);

  const subject = "🔴 FIRESTORE INDEX REQUIRED";

  const message = `A Firestore index is missing and preventing normal operation.

**Endpoint:** ${context.endpoint}
**Collection:** ${context.collection || "Unknown"}
**Fields:** ${context.fields?.join(", ") || "Unknown"}
**Query:** ${context.query || "Unknown"}

**Error Details:**
${errorMessage}

**Firebase Console URL:**
${analysis.indexUrl || "Check Firebase Console > Firestore > Indexes"}

**User Impact:**
Users are seeing error messages instead of the expected functionality.

**Required Action:**
1. Go to Firebase Console > Firestore > Indexes
2. Create the missing composite index as indicated in the error
3. Wait for index to build (usually 5-15 minutes)
4. Verify functionality is restored

**Note:** This is a configuration issue, not a code bug. The index needs to be created in the Firebase Console.`;

  try {
    await sendOpsAlert(subject, message, {
      error: error instanceof Error ? error : new Error(String(error)),
      context: {
        ...context,
        errorType: "firestore_index_missing",
        timestamp: new Date().toISOString(),
        indexUrl: analysis.indexUrl,
      },
    });
  } catch (emailError) {
    console.error("Failed to send Firestore index ops alert:", emailError);
  }
}

/**
 * Creates a standardized error response for Firestore index errors
 */
export function createIndexErrorResponse(
  error: unknown,
  context: {
    endpoint: string;
    collection?: string;
    fields?: string[];
    query?: string;
  }
) {
  const analysis = analyzeFirestoreError(error);

  if (!analysis.isIndexError) {
    // Not an index error, return generic error
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return {
      error: errorMessage,
      type: "generic_error",
    };
  }

  // Log the error for debugging
  console.error(`Firestore index error at ${context.endpoint}:`, {
    error: error instanceof Error ? error.message : String(error),
    context,
    analysis,
  });

  // Send ops notification if needed (async, don't wait)
  if (analysis.shouldNotifyOps) {
    notifyOpsOfIndexError(error, context).catch(console.error);
  }

  return {
    error: analysis.userMessage,
    type: "firestore_index_error",
    isBuilding: analysis.isBuilding,
    adminMessage: analysis.adminMessage,
    indexUrl: analysis.indexUrl,
  };
}
