import { NextApiRequest, NextApiResponse } from "next";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { ChatOpenAI } from "@langchain/openai";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { db } from "@/services/firebase";

interface SuggestPromptRequest {
  uuid: string;
}

interface SuggestPromptResponse {
  suggestions: string[];
  hasEnoughHistory: boolean;
}

async function suggestPromptHandler(
  req: NextApiRequest,
  res: NextApiResponse<SuggestPromptResponse | { message: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Apply rate limiting
  const rateLimitPassed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
    name: "suggestPrompt",
  });

  if (!rateLimitPassed) {
    return; // Response already sent by rate limiter
  }

  try {
    const { uuid }: SuggestPromptRequest = req.body;

    // Validate input
    if (!uuid || typeof uuid !== "string") {
      return res.status(400).json({ message: "UUID is required and must be a string" });
    }

    // Fetch recent chat history
    const collectionName = getAnswersCollectionName();
    if (!db) {
      return res.status(500).json({ message: "Database connection not available" });
    }

    const query = db.collection(collectionName).where("uuid", "==", uuid).orderBy("timestamp", "desc").limit(10);

    const snapshot = await query.get();
    const chats = snapshot.docs.map((doc) => ({
      id: doc.id,
      question: doc.data().question,
      answer: doc.data().answer,
      restatedQuestion: doc.data().restatedQuestion,
      timestamp: doc.data().timestamp,
    }));

    // Check if we have enough history
    if (chats.length < 5) {
      return res.status(200).json({
        suggestions: [],
        hasEnoughHistory: false,
      });
    }

    // Helper to truncate answer at word boundary to 800 characters
    const truncateAnswer = (answer: string, max = 800): string => {
      if (answer.length <= max) return answer;

      // scan backwards for first acceptable breakpoint (newline, space, punctuation)
      const breakChars = new Set([" ", ".", "!", "?", ",", ";", "\n"]);
      for (let i = max; i >= 0; i--) {
        const ch = answer[i];
        if (breakChars.has(ch)) {
          // avoid ultra-short truncations (< 400) – fallback to hard cut later
          if (i < max * 0.5) break;
          return answer.slice(0, ch === " " || ch === "\n" ? i : i + 1).trim() + "…";
        }
      }

      // fallback hard cut
      return answer.slice(0, max).trim() + "…";
    };

    // Build context from recent chats, prioritizing most recent
    const maxContextLength = 10000; // generous – low-volume app
    const contextSegments: string[] = [];
    let accumulatedLength = 0;

    for (let i = 0; i < Math.min(chats.length, 8); i++) {
      const q = chats[i].restatedQuestion || chats[i].question;
      const aSnippet = truncateAnswer(chats[i].answer || "");
      const segment = `User: ${q}\nAssistant: ${aSnippet}`;

      if (accumulatedLength + segment.length + 2 > maxContextLength) break;

      contextSegments.push(segment);
      accumulatedLength += segment.length + 2;
    }

    const context = contextSegments.join("\n\n");

    // Initialize OpenAI model - using gpt-3.5-turbo for cost efficiency
    const model = new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      temperature: 0.8, // Slightly higher for variety
      maxTokens: 200, // More tokens for 3 questions with detailed prompt
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    // Create the prompt for suggestion generation
    const prompt = `Based on this recent conversation, suggest THREE different personalized questions I might want to ask next. Each question should:
- Be a direct question (like "How can I..." or "What does..." or "Why is...")
- End with a question mark
- Be under 15 words
- Be conversational and relevant to the topics discussed
- Offer different angles or aspects to explore
- Aim for variety in question types (practical, conceptual, exploratory, etc.)

IMPORTANT: You MUST provide exactly 3 questions. Do not provide fewer than 3. If you're struggling to find 3 different angles, think creatively about related topics, practical applications, or deeper exploration of the themes discussed. Ensure the questions are diverse in their approach and focus.

Recent conversation (NEWEST first, prioritize the first few exchanges):
${context}

Format your response as exactly 3 numbered questions:
1. [First question]
2. [Second question] 
3. [Third question]`;

    // Call OpenAI directly
    const response = await model.invoke(prompt);

    let content = response.content as string;
    content = content.trim();

    // Parse the numbered list of suggestions
    const suggestions: string[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      // Match numbered lines like "1. How about..." or "1) What about..."
      const match = trimmedLine.match(/^\d+[.)]\s*(.+)$/);
      if (match) {
        const suggestion = match[1].trim();

        // Ensure it ends with a question mark and is reasonable length
        if (suggestion.endsWith("?") && suggestion.length > 5 && suggestion.length < 200) {
          suggestions.push(suggestion);
        }
      }
    }

    // If we don't have enough suggestions, return error so component falls back to Random Queries
    if (suggestions.length !== 3) {
      throw new Error("Failed to parse exactly 3 AI suggestions");
    }

    // Take only first 3 if we got more, or return what we have (1-3 suggestions)
    const finalSuggestions = suggestions.slice(0, 3);

    return res.status(200).json({
      suggestions: finalSuggestions,
      hasEnoughHistory: true,
    });
  } catch (error) {
    console.error("Error generating prompt suggestions:", error);

    // Return error so component falls back to Random Queries
    return res.status(500).json({ message: "Failed to generate suggestions" });
  }
}

export default withApiMiddleware(withJwtAuth(suggestPromptHandler));
