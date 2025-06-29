// This file handles API requests for fetching and deleting answers.
// It provides functionality to retrieve answers with pagination, sorting, and filtering options,
// as well as deleting individual answers with proper authentication.

import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { getSudoCookie } from "@/utils/server/sudoCookieUtils";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { getTotalDocuments, getAnswersByIds } from "@/utils/server/answersUtils";
import { Answer } from "@/types/answer";
import { Document } from "langchain/document";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { firestoreQueryGet, firestoreDelete } from "@/utils/server/firestoreRetryUtils";

// 6/23/24: likedOnly filtering not being used in UI but leaving here for potential future use

// Retrieves answers based on specified criteria (page, limit, liked status, and sort order)
// Returns an array of answers and the total number of pages
async function getAnswers(
  page: number,
  limit: number,
  likedOnly: boolean,
  sortBy: string
): Promise<{ answers: Answer[]; totalPages: number }> {
  // Check if db is available
  if (!db) {
    throw new Error("Database not available");
  }

  // Initialize the query with sorting options
  let answersQuery = db
    .collection(getAnswersCollectionName())
    .orderBy(sortBy === "mostPopular" ? "likeCount" : "timestamp", "desc");

  // Add secondary sorting by timestamp for 'mostPopular' option
  if (sortBy === "mostPopular") {
    answersQuery = answersQuery.orderBy("timestamp", "desc");
  }

  // Calculate pagination details
  const totalDocs = await getTotalDocuments();
  const totalPages = Math.max(1, Math.ceil(totalDocs / limit)); // Ensure at least 1 page
  const offset = (page - 1) * limit;

  // Apply pagination to the query
  answersQuery = answersQuery.offset(offset).limit(limit);

  // Filter for liked answers if specified
  if (likedOnly) {
    answersQuery = answersQuery.where("likeCount", ">", 0);
  }

  // Execute the query and process the results
  const answersSnapshot = await firestoreQueryGet(
    answersQuery,
    "answers list query",
    `offset: ${offset}, limit: ${limit}, likedOnly: ${likedOnly}, sortBy: ${sortBy}`
  );

  const answers = answersSnapshot.docs.map((doc: any) => {
    const data = doc.data();
    let sources: Document[] = [];

    // Parse sources, handling potential errors
    try {
      sources = data.sources ? (JSON.parse(data.sources) as Document[]) : [];
    } catch (e) {
      // Very early sources were stored in non-JSON so recognize those and only log an error for other cases
      if (!data.sources.trim().substring(0, 50).includes("Sources:")) {
        console.error("Error parsing sources:", e);
        console.log("data.sources: '" + data.sources + "'");
        if (!data.sources || data.sources.length === 0) {
          console.log("data.sources is empty or null");
        }
      }
    }

    // Construct and return the Answer object
    return {
      id: doc.id,
      question: data.question,
      answer: data.answer,
      timestamp: data.timestamp,
      sources: sources as Document<Record<string, unknown>>[],
      vote: data.vote,
      collection: data.collection,
      ip: data.ip,
      likeCount: data.likeCount || 0,
      relatedQuestionsV2: data.relatedQuestionsV2 || [],
      related_questions: data.related_questions,
      adminAction: data.adminAction,
      adminActionTimestamp: data.adminActionTimestamp,
      history: data.history || undefined,
      feedbackReason: data.feedbackReason,
      feedbackComment: data.feedbackComment,
      feedbackTimestamp: data.feedbackTimestamp,
    } as Answer;
  });

  return { answers, totalPages };
}

// Deletes an answer by its ID
async function deleteAnswerById(id: string): Promise<void> {
  // Check if db is available
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    await firestoreDelete(db.collection(getAnswersCollectionName()).doc(id), "answer deletion", `answerId: ${id}`);
  } catch (error) {
    console.error("Error deleting answer: ", error);
    throw error;
  }
}

// Create a custom handler that applies different auth requirements based on the method
async function apiHandler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;

  // For GET requests, no authentication is required
  if (method === "GET") {
    return await handleGetRequest(req, res);
  }

  // For DELETE requests, authentication is required - will be handled by withJwtAuth
  if (method === "DELETE") {
    return await handleDeleteRequest(req, res);
  }

  // For unsupported methods
  res.setHeader("Allow", ["GET", "DELETE"]);
  return res.status(405).json({ error: "Method not allowed" });
}

// For GET requests, don't require authentication
const getHandler = withApiMiddleware(apiHandler, { skipAuth: true });

// For DELETE requests, require authentication
const deleteHandler = withApiMiddleware(withJwtAuth(apiHandler));

// Export the main handler that routes based on method
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;

  if (method === "GET") {
    return getHandler(req, res);
  }

  if (method === "DELETE") {
    return deleteHandler(req, res);
  }

  // For other methods, use the unauthenticated handler to return 405
  return getHandler(req, res);
}

// Main handler function for the API endpoint
async function handleGetRequest(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // 100 requests per 5 minutes
    name: "answers-api",
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  try {
    const { answerIds } = req.query;

    if (answerIds) {
      // Handle fetching specific answers by IDs
      if (typeof answerIds !== "string") {
        return res.status(400).json({
          message: "answerIds parameter must be a comma-separated string.",
        });
      }
      const idsArray = answerIds.split(",");

      const answers = await getAnswersByIds(idsArray);

      if (answers.length === 0) {
        return res.status(404).json({ message: "Answer not found." });
      }

      res.status(200).json(answers);
    } else {
      // Handle fetching answers with pagination and filtering
      const { page, limit, likedOnly, sortBy } = req.query;
      const pageNumber = parseInt(page as string) || 1; // Default to page 1 if not provided
      const limitNumber = parseInt(limit as string) || 10;
      const likedOnlyFlag = likedOnly === "true";
      const sortByValue = (sortBy as string) || "mostRecent";

      const { answers, totalPages } = await getAnswers(pageNumber, limitNumber, likedOnlyFlag, sortByValue);

      res.status(200).json({ answers, totalPages });
    }
  } catch (error: unknown) {
    // Error handling for GET requests
    console.error("Error fetching answers: ", error);
    if (error instanceof Error) {
      if ("code" in error && error.code === 8) {
        res.status(429).json({
          message: "Error: Quota exceeded. Please try again later.",
        });
      } else if (error.message === "Database not available") {
        res.status(503).json({ message: "Database not available" });
      } else {
        res.status(500).json({
          message: "Error fetching answers",
          error: error.message,
        });
      }
    } else {
      res.status(500).json({ message: "An unknown error occurred" });
    }
  }
}

// Deletes an answer by its ID
async function handleDeleteRequest(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Handle deleting an answer
    const { answerId } = req.query;
    if (!answerId || typeof answerId !== "string") {
      return res.status(400).json({ message: "answerId parameter is required." });
    }

    // Check for sudo permissions before allowing deletion
    // This is sufficient for deleting answers; siteAuth cookie is not required
    const sudo = getSudoCookie(req, res);
    if (!sudo.sudoCookieValue) {
      return res.status(403).json({ message: `Forbidden: ${sudo.message}` });
    }

    await deleteAnswerById(answerId);
    res.status(200).json({ message: "Answer deleted successfully." });
  } catch (error: unknown) {
    // Error handling for DELETE requests
    console.error("Handler: Error deleting answer: ", error);
    if (error instanceof Error) {
      if (error.message === "Database not available") {
        res.status(503).json({ message: "Database not available" });
      } else {
        res.status(500).json({
          message: "Error deleting answer",
          error: error.message,
        });
      }
    } else {
      res.status(500).json({
        message: "Error deleting answer",
        error: "An unknown error occurred",
      });
    }
  }
}
