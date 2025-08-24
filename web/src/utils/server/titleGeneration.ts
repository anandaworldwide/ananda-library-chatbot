/**
 * Title Generation Utility
 *
 * Generates concise 4-word titles for chat conversations using AI.
 * Falls back to truncated questions if AI generation fails.
 */

import { ChatOpenAI } from "@langchain/openai";
import { firestoreUpdate } from "@/utils/server/firestoreRetryUtils";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { db } from "@/services/firebase";

/**
 * Generates a concise 4-word title for a question using AI
 * Only generates titles for questions longer than 5 words
 */
async function generateAITitle(question: string): Promise<string | null> {
  try {
    const words = question.trim().split(/\s+/);

    // If question is 5 words or less, don't generate AI title - use exact text
    if (words.length <= 5) {
      return null; // This will cause fallback to exact question text
    }

    // Use fast model for title generation
    const model = new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      temperature: 0.1,
      maxTokens: 20, // Keep it short
      timeout: 10000, // 10 second timeout
    });

    const prompt = `Generate a concise four-word title for this question: "${question}"

Requirements:
- Exactly 4 words
- Capture the main topic
- No punctuation
- Title case
- IMPORTANT: Generate the title in the SAME LANGUAGE as the original question

Examples:
Question: "How do I meditate properly?"
Title: "Proper Meditation Technique Guide"

Question: "What are Yogananda's teachings about love?"
Title: "Yogananda Love Teaching Wisdom"

Question: "¿Cuáles son los principios de meditación?"
Title: "Principios Básicos Meditación Espiritual"

Question: "Comment méditer correctement selon Yogananda?"
Title: "Méditation Correcte Selon Yogananda"

Title:`;

    const response = await model.invoke(prompt);
    const title = response.content?.toString()?.trim();

    if (title && title.split(" ").length <= 6) {
      // Allow some flexibility
      return title;
    }

    return null;
  } catch (error) {
    console.error("AI title generation failed:", error);
    return null;
  }
}

/**
 * Creates a fallback title by truncating the question
 */
function createFallbackTitle(question: string): string {
  const words = question.trim().split(/\s+/);

  // If question is 5 words or less, use the full question
  if (words.length <= 5) {
    return question;
  }

  // Otherwise, take first 4 words and add ellipsis if needed
  const truncated = words.slice(0, 4).join(" ");
  return truncated + (words.length > 4 ? "..." : "");
}

/**
 * Generates a title for a conversation and updates the document
 * This function is designed to be called asynchronously (fire-and-forget)
 */
export async function generateAndUpdateTitle(docId: string, question: string): Promise<void> {
  try {
    // Try AI generation first
    let title = await generateAITitle(question);

    // Fall back to truncated question if AI fails
    if (!title) {
      title = createFallbackTitle(question);
    }

    // Update the document with the generated title
    if (!db) {
      throw new Error("Database not available");
    }
    const docRef = db.collection(getAnswersCollectionName()).doc(docId);
    await firestoreUpdate(docRef, { title }, "title generation update", `docId: ${docId}, title: ${title}`);

    console.log(`Generated title for ${docId}: "${title}"`);
  } catch (error) {
    console.error(`Title generation failed for ${docId}:`, error);

    // Try to update with fallback title even if AI failed
    try {
      const fallbackTitle = createFallbackTitle(question);
      if (!db) {
        console.error("Database not available for fallback title update");
        return;
      }
      const docRef = db.collection(getAnswersCollectionName()).doc(docId);
      await firestoreUpdate(
        docRef,
        { title: fallbackTitle },
        "fallback title update",
        `docId: ${docId}, fallback title: ${fallbackTitle}`
      );
      console.log(`Used fallback title for ${docId}: "${fallbackTitle}"`);
    } catch (fallbackError) {
      console.error(`Even fallback title update failed for ${docId}:`, fallbackError);
    }
  }
}

/**
 * Synchronous title generation for immediate use (e.g., in tests or when title is needed immediately)
 */
export async function generateTitle(question: string): Promise<string> {
  const aiTitle = await generateAITitle(question);
  return aiTitle || createFallbackTitle(question);
}
