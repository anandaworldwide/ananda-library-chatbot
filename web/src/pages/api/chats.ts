// Lists chats (question/answer pairs) for a given UUID in reverse chronological order
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreQueryGet } from "@/utils/server/firestoreRetryUtils";
import { createIndexErrorResponse } from "@/utils/server/firestoreIndexErrorHandler";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Basic rate limiting
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000,
    max: 60,
    name: "chats-api",
  });
  if (!allowed) return;

  const { uuid, limit, convId, startAfter } = req.query;
  if (!uuid || typeof uuid !== "string") {
    return res.status(400).json({ error: "uuid query parameter is required" });
  }

  const limitNum = Math.min(Math.max(parseInt(String(limit || 50), 10) || 50, 1), 200);

  try {
    if (!db) return res.status(503).json({ error: "Database not available" });

    // Build query based on whether convId is specified
    let query = db.collection(getAnswersCollectionName()).where("uuid", "==", uuid);

    // Add convId filter if specified
    if (convId && typeof convId === "string") {
      query = query.where("convId", "==", convId);
    }

    query = query.orderBy("timestamp", "desc");

    // Add pagination cursor if provided
    if (startAfter && typeof startAfter === "string") {
      // Parse the timestamp from ISO string
      const startAfterDate = new Date(startAfter);
      query = query.startAfter(startAfterDate);
    }

    query = query.limit(limitNum);

    const contextString = convId
      ? `uuid: ${uuid}, convId: ${convId}, limit: ${limitNum}, startAfter: ${startAfter || "none"}`
      : `uuid: ${uuid}, limit: ${limitNum}, startAfter: ${startAfter || "none"}`;

    const snapshot = await firestoreQueryGet(query, "user chats list", contextString);

    const chats = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        question: data.question,
        answer: data.answer,
        timestamp: data.timestamp,
        likeCount: data.likeCount || 0,
        collection: data.collection,
        convId: data.convId || null, // Include convId in response
        title: data.title || null, // Include title in response
        sources: data.sources || null, // Include sources in response
      };
    });

    return res.status(200).json(chats);
  } catch (error: any) {
    // Handle Firestore index errors with proper user messaging and ops notifications
    const errorResponse = createIndexErrorResponse(error, {
      endpoint: "/api/chats",
      collection: getAnswersCollectionName(),
      fields: convId ? ["uuid", "convId", "timestamp"] : ["uuid", "timestamp"],
      query: convId ? `uuid=${uuid}, convId=${convId}, orderBy timestamp desc` : `uuid=${uuid}, orderBy timestamp desc`,
    });

    return res.status(500).json(errorResponse);
  }
}
