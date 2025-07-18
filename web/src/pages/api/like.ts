// This file handles API requests for managing likes on answers, including adding/removing likes,
// checking like statuses, and fetching like counts. It uses Firebase for data storage and implements
// rate limiting and caching for improved performance.

import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import firebase from "firebase-admin";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { getEnvName, isDevelopment } from "@/utils/env";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";

// Cache to store like statuses, improving response times for frequent requests
const likeStatusCache: Record<string, Record<string, boolean>> = {};

const envName = getEnvName();

// Check if db is available
function checkDbAvailable(res: NextApiResponse): boolean {
  if (!db) {
    res.status(503).json({ error: "Database not available" });
    return false;
  }
  return true;
}

// Handler for GET requests to check like statuses
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  let answerIds = req.query.answerIds;
  const { uuid } = req.query;

  // Validate UUID
  if (!uuid) {
    return res.status(400).json({ error: "Missing UUID" });
  }

  // Check if db is available
  if (!checkDbAvailable(res)) return;

  try {
    console.log(`Likes GET: UUID: ${uuid}`);
    const likesCollection = db!.collection(`${envName}_likes`);

    // If no answerIds are provided, return all liked answer IDs for this user
    if (!answerIds) {
      const likesSnapshot = await likesCollection.where("uuid", "==", uuid).get();

      // Create an array of answer IDs that this user has liked
      const likedAnswerIds: string[] = [];
      likesSnapshot.forEach((doc) => {
        likedAnswerIds.push(doc.data().answerId);
      });

      return res.status(200).json(likedAnswerIds);
    }

    // Otherwise, handle the normal case with specific answer IDs
    // Ensure answerIds is an array
    if (typeof answerIds === "string") {
      answerIds = [answerIds];
    } else if (!Array.isArray(answerIds)) {
      return res.status(400).json({ error: "Invalid answerIds format" });
    }

    console.log(`Likes GET: Answer IDs: ${answerIds}`);
    const likesSnapshot = await likesCollection.where("uuid", "==", uuid).where("answerId", "in", answerIds).get();

    // Create an object to store the like statuses
    const likeStatuses: Record<string, boolean> = {};
    likesSnapshot.forEach((doc) => {
      likeStatuses[doc.data().answerId] = true;
    });

    // Fill in false for any answerIds not found
    answerIds.forEach((id: string) => {
      if (!likeStatuses[id]) {
        likeStatuses[id] = false;
      }
    });

    res.status(200).json(likeStatuses);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Something went wrong";
    res.status(500).json({ error: errorMessage });
  }
}

// Handler for POST requests to check like statuses (with caching)
async function handlePostCheck(req: NextApiRequest, res: NextApiResponse) {
  const { answerIds, uuid } = req.body;

  // Validate the input
  if (!Array.isArray(answerIds) || !uuid) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  // Check if db is available
  if (!checkDbAvailable(res)) return;

  try {
    // Create a cache key based on the user's UUID
    const cacheKey = `user_${uuid}`;

    // Check if the like statuses are already cached for the given user
    if (likeStatusCache[cacheKey]) {
      const cachedLikeStatuses = likeStatusCache[cacheKey];
      const filteredLikeStatuses: Record<string, boolean> = {};

      // Filter the cached like statuses based on the provided answer IDs
      answerIds.forEach((answerId) => {
        if (answerId in cachedLikeStatuses) {
          filteredLikeStatuses[answerId] = cachedLikeStatuses[answerId];
        }
      });

      // If all the requested answer IDs are found in the cache, return the filtered like statuses
      if (Object.keys(filteredLikeStatuses).length === answerIds.length) {
        return res.status(200).json(filteredLikeStatuses);
      }
    }

    const likesCollection = db!.collection(`${envName}_likes`);
    const likesSnapshot = await likesCollection.where("uuid", "==", uuid).where("answerId", "in", answerIds).get();

    // Create an object to store the like statuses
    const likeStatuses: Record<string, boolean> = {};
    likesSnapshot.forEach((doc) => {
      likeStatuses[doc.data().answerId] = true;
    });

    // Fill in false for any answerIds not found
    answerIds.forEach((id: string) => {
      if (!likeStatuses[id]) {
        likeStatuses[id] = false;
      }
    });

    // Update the cache with the fetched like statuses
    likeStatusCache[cacheKey] = {
      ...likeStatusCache[cacheKey],
      ...likeStatuses,
    };

    res.status(200).json(likeStatuses);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Something went wrong";
    res.status(500).json({ error: errorMessage });
  }
}

// Handler to fetch like counts for multiple answer IDs
async function handlePostLikeCounts(req: NextApiRequest, res: NextApiResponse) {
  let answerIds = req.body.answerIds;

  // Ensure answerIds is an array
  if (typeof answerIds === "string") {
    answerIds = [answerIds];
  } else if (!Array.isArray(answerIds)) {
    return res.status(400).json({ error: "Invalid answerIds format" });
  }

  // Check if db is available
  if (!checkDbAvailable(res)) return;

  try {
    const likesCollection = db!.collection(`${envName}_likes`);
    const likesSnapshot = await likesCollection.where("answerId", "in", answerIds).get();

    // Initialize an object to store the like counts
    const likeCounts: Record<string, number> = {};

    // Aggregate the likes for each answerId
    likesSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (!likeCounts[data.answerId]) {
        likeCounts[data.answerId] = 0;
      }
      likeCounts[data.answerId] += 1;
    });

    res.status(200).json(likeCounts);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Something went wrong";
    res.status(500).json({ error: errorMessage });
  }
}

// Main handler function for all like-related API requests
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting to prevent abuse
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000 * 10, // 10 minutes
    max: isDevelopment() ? 3000 : 30, // 3000 likes per 10 minutes in dev, 30 in prod
    name: "like",
  });

  if (!isAllowed) {
    return res.status(429).json({ error: "Too many likes. Please try again later." });
  }

  const action = req.query.action;

  // Route requests to appropriate handlers based on method and action
  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "POST" && action === "check") {
    return handlePostCheck(req, res);
  } else if (req.method === "POST" && action === "counts") {
    return handlePostLikeCounts(req, res);
  } else if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Handle adding or removing a like
  const { answerId, like, uuid } = req.body;
  if (!answerId || typeof like !== "boolean" || !uuid) {
    return res.status(400).json({ error: "Missing answer ID, UUID or invalid like status" });
  }

  // Check if db is available
  if (!checkDbAvailable(res)) return;

  try {
    const likesCollection = db!.collection(`${envName}_likes`);

    if (like) {
      // Add a new like document
      await likesCollection.add({
        uuid: uuid,
        answerId: answerId,
        timestamp: new Date(),
      });

      // Increment the like count in the chat logs
      const chatLogRef = db!.collection(getAnswersCollectionName()).doc(answerId);
      await chatLogRef.update({
        likeCount: firebase.firestore.FieldValue.increment(1),
      });

      // Invalidate the cache for the user
      delete likeStatusCache[`user_${uuid}`];

      res.status(200).json({ message: "Like added" });
    } else {
      // Remove the like document if it exists
      const querySnapshot = await likesCollection
        .where("uuid", "==", uuid)
        .where("answerId", "==", answerId)
        .limit(1)
        .get();

      if (!querySnapshot.empty) {
        // Delete the like document
        const docRef = querySnapshot.docs[0].ref;
        await docRef.delete();

        // Decrement the like count in the chat logs
        const chatLogRef = db!.collection(getAnswersCollectionName()).doc(answerId);
        await chatLogRef.update({
          likeCount: firebase.firestore.FieldValue.increment(-1),
        });

        // Invalidate the cache for the user
        delete likeStatusCache[`user_${uuid}`];

        res.status(200).json({ message: "Like removed" });
      } else {
        res.status(404).json({ error: "Like not found" });
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Something went wrong";
    res.status(500).json({ error: errorMessage });
  }
}

// async function checkLikeCountIntegrity() {
//   try {
//     const chatLogsSnapshot = await db.collection(getChatLogsCollectionName()).get();
//     const likesSnapshot = await db.collection(`${envName}_likes`).get();

//     const chatLogLikeCounts: Record<string, number> = {};
//     const likeCounts: Record<string, number> = {};

//     // Collect like counts from chat logs
//     chatLogsSnapshot.forEach(doc => {
//       const data = doc.data();
//       chatLogLikeCounts[doc.id] = data.likeCount || 0;
//     });

//     // Collect like counts from likes table
//     likesSnapshot.forEach(doc => {
//       const data = doc.data();
//       const answerId = data.answerId;
//       likeCounts[answerId] = (likeCounts[answerId] || 0) + 1;
//     });

//     let discrepancyFound = false;

//     // Compare like counts
//     for (const answerId in chatLogLikeCounts) {
//       const chatLogLikeCount = chatLogLikeCounts[answerId];
//       const likeCount = likeCounts[answerId] || 0;

//       if (chatLogLikeCount !== likeCount) {
//         console.log(`ERROR: Discrepancy found for answerId ${answerId}:`);
//         console.log(`Chat log like count: ${chatLogLikeCount}`);
//         console.log(`Likes table count: ${likeCount}`);
//         discrepancyFound = true;
//       }
//     }

//     // if (!discrepancyFound) {
//     //   console.log('Like count integrity check passed. No discrepancies found.');
//     // }

//     for (const [answerId, count] of Object.entries(likeCounts)) {
//       const uuids = likesSnapshot.docs
//         .filter(doc => doc.data().answerId === answerId)
//         .map(doc => doc.data().uuid);
//       console.log(`Answer ID: ${answerId}, Like Count: ${count}, UUIDs: ${uuids.join(', ')}`);
//     }
//   } catch (error: any) {
//     console.error('Error during like count integrity check:', error);
//   }
// }

// Apply API middleware and JWT authentication for security
export default withApiMiddleware(withJwtAuth(handler));
