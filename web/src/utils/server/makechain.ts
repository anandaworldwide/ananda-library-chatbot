/**
 * This file implements a configurable chat system using LangChain, supporting multiple language models,
 * document retrieval from various sources, and site-specific configurations.
 *
 * Key features:
 * - Flexible document retrieval from multiple "libraries" with configurable weights
 * - Site-specific configurations loaded from local files or S3
 * - Template system with variable substitution for customizing prompts
 * - Support for follow-up questions by maintaining chat history
 * - Automatic conversion of follow-up questions into standalone queries
 * - Proportional document retrieval across knowledge bases
 * - Model comparison capabilities for A/B testing different LLMs
 * - Streaming support for real-time responses
 * - Performance optimization: Uses faster model (gpt-3.5-turbo) for question rephrasing
 *
 * The system uses a multi-stage pipeline:
 * 1. Question processing - Converts follow-ups into standalone questions
 * 2. Document retrieval - Fetches relevant docs from vector stores
 * 3. Context preparation - Combines docs and chat history
 * 4. Answer generation - Uses LLM to generate final response
 *
 * Configuration is handled through JSON files that specify:
 * - Included libraries and their weights
 * - Custom prompt templates
 * - Site-specific variables
 * - Model parameters (temperature, etc)
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import type { Document } from "langchain/document";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";
import fs from "fs/promises";
import path from "path";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { StreamingResponseData } from "@/types/StreamingResponseData";
import { PineconeStore } from "@langchain/pinecone";

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { SiteConfig as AppSiteConfig } from "@/types/siteConfig";
import { ChatMessage, convertChatHistory } from "@/utils/shared/chatHistory";
import { NextRequest } from "next/server";
import { sendOpsAlert } from "./emailOps";

// S3 client for loading remote templates and configurations
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-west-1",
});

// Define types and interfaces for the chain input and configuration
type AnswerChainInput = {
  question: string;
  chat_history: string;
  context?: any; // Added for tool execution results
  tool_messages?: any[]; // Added for tool execution messages
};

export type CollectionKey = "master_swami" | "whole_library";

interface TemplateContent {
  content?: string;
  file?: string;
}

// Site configuration for makechain
interface SiteConfig {
  variables: Record<string, string>;
  templates: Record<string, TemplateContent>;
  modelName?: string;
  temperature?: number;
  siteId?: string;
}

// Add new interface for model config
interface ModelConfig {
  model: string;
  temperature: number;
  label?: string; // For identifying which model in streaming responses
}

// Define TimingMetrics interface directly here
interface TimingMetrics {
  startTime?: number;
  pineconeSetupComplete?: number;
  firstTokenGenerated?: number;
  firstByteTime?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
  totalTime?: number;
  ttfb?: number;
}

// Loads text content from local filesystem with error handling
async function loadTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    console.warn(`Failed to load file: ${filePath}. Using empty string. (Error: ${error})`);
    return "";
  }
}

// Converts S3 readable stream to string for template loading
async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

// Determines the prompt environment based on NODE_ENV
function getPromptEnvironment(): string {
  const nodeEnv = process.env.NODE_ENV;

  // Production and preview environments use prod templates
  if (nodeEnv === "production" || process.env.VERCEL_ENV === "preview") {
    return "prod";
  }

  return "dev";
}

// Retrieves template content from S3 bucket with error handling
// TODO: add caching to this function
async function loadTextFileFromS3(bucket: string, key: string): Promise<string> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error("Empty response body");
    }

    return await streamToString(response.Body as Readable);
  } catch (error) {
    console.error(`Failed to load from S3: ${bucket}/${key}`, error);

    // Send ops alert for S3 loading failures
    try {
      await sendOpsAlert("S3 load failure", `Failed to load from S3: ${bucket}/${key}`, {
        error: error as Error,
        context: {
          operation: "load",
          bucket,
          key,
          function: "loadTextFileFromS3",
          template: key.includes("prompts/") ? "prompt template" : "configuration file",
        },
        stack: (error as Error).stack,
      });
    } catch (emailError) {
      console.error("Failed to send ops alert for S3 error:", emailError);
    }

    return "";
  }
}

// Processes a template by either using inline content or loading from file/S3
// Supports variable substitution using the provided variables map
async function processTemplate(
  template: TemplateContent,
  variables: Record<string, string>,
  basePath: string
): Promise<string> {
  let content = template.content || "";
  if (template.file) {
    if (template.file.toLowerCase().startsWith("s3:".toLowerCase())) {
      // Load from S3
      if (!process.env.S3_BUCKET_NAME) {
        throw new Error("S3_BUCKET_NAME not configured but s3: file path specified");
      }
      const startTime = Date.now();
      const s3Path = template.file.slice(3); // Remove 's3:' prefix
      const envPath = getPromptEnvironment();
      const s3Key = `site-config/${envPath}/prompts/${s3Path}`;
      content = await loadTextFileFromS3(process.env.S3_BUCKET_NAME, s3Key);
      const loadTime = Date.now() - startTime;
      console.log(`Loading S3 file took ${loadTime}ms`);
    } else {
      // Load from local filesystem
      content = await loadTextFile(path.join(basePath, template.file));
    }
  }
  return substituteVariables(content, variables);
}

// Replaces ${variable} syntax in templates with actual values from variables map
function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\${(\w+)}/g, (_, key) => variables[key] || `\${${key}}`);
}

// Loads site-specific configuration with fallback to default config
// Configurations control prompt templates, variables, and model behavior
async function loadSiteConfig(siteId: string): Promise<SiteConfig> {
  const promptsDir = process.env.SITE_PROMPTS_DIR || path.join(process.cwd(), "site-config/prompts");
  const configPath = path.join(promptsDir, `${siteId}.json`);

  try {
    const data = await fs.readFile(configPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(`ERROR: Failed to load site-specific config for ${siteId}. Using default. (Error: ${error})`);
    const defaultPath = path.join(promptsDir, "default.json");
    const defaultData = await fs.readFile(defaultPath, "utf8");
    return JSON.parse(defaultData);
  }
}

// Processes the entire site configuration, loading all templates and applying variables
async function processSiteConfig(config: SiteConfig, basePath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {
    ...config.variables,
    date: new Date().toLocaleDateString(),
  };

  for (const [key, template] of Object.entries(config.templates)) {
    result[key] = await processTemplate(template, result, basePath);
  }

  return result;
}

// Builds the complete chat prompt template for a specific site, incorporating
// site-specific variables and configurations
const getFullTemplate = async (siteId: string) => {
  const promptsDir = process.env.SITE_PROMPTS_DIR || path.join(process.cwd(), "site-config/prompts");
  const config = await loadSiteConfig(siteId);
  const processedConfig = await processSiteConfig(config, promptsDir);

  // Get the base template
  let fullTemplate = processedConfig.baseTemplate || "";

  // Replace variables from the 'variables' object
  if (config.variables) {
    for (const [key, value] of Object.entries(config.variables)) {
      const placeholder = new RegExp(`\\{${key}\\}`, "g");
      fullTemplate = fullTemplate.replace(placeholder, value);
    }
  }

  return fullTemplate;
};

// Template for converting follow-up questions into standalone questions
// This helps maintain context while allowing effective vector store querying
const CONDENSE_TEMPLATE = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

IMPORTANT: NEVER reformulate social messages or conversation closers. If the follow up input includes ANY 
of the following:
1. Expressions of gratitude: "thanks", "thank you", "gracias", "merci", "danke", etc.
2. Conversation closers: "that's all", "I'm all set", "got it", "that's what I needed", "okay then", etc.
3. Acknowledgments: "I understand", "I see", "sounds good", "makes sense", etc.
4. General positive feedback: "great", "wonderful", "perfect", "nice", "awesome", etc.

DO NOT attempt to reformulate these into questions. Instead, return EXACTLY what the user said, word for word.

Examples of inputs you should return unchanged:
- "Thanks for the information!"
- "That's all I needed, thank you."
- "Sounds good, I'll check that out."
- "Perfect, thank you very much."
- "Great, that answers my question."
- "I'm all set, thanks!"
- "That's helpful, I appreciate it."
- "Got it, thanks for explaining."
- "Okay, thank you!"
- "I understand now, thanks."

<chat_history>
  {chat_history}
</chat_history>

Follow Up Input: {question}
Standalone question:`;

// Serializes retrieved documents into a format suitable for the language model
// Includes content, metadata, and library information
const combineDocumentsFn = (docs: Document[]) => {
  const serializedDocs = docs.map((doc) => ({
    content: doc.pageContent,
    metadata: doc.metadata,
    id: doc.id,
    library: doc.metadata.library,
  }));
  return JSON.stringify(serializedDocs);
};

// Calculates how many sources to retrieve from each library based on configured weights
// This enables proportional document retrieval across multiple slices of the knowledge base
const calculateSources = (totalSources: number, libraries: { name: string; weight?: number }[]) => {
  if (!libraries || libraries.length === 0) {
    return [];
  }

  const totalWeight = libraries.reduce((sum, lib) => sum + (lib.weight !== undefined ? lib.weight : 1), 0);
  return libraries.map((lib) => ({
    name: lib.name,
    sources:
      lib.weight !== undefined
        ? Math.round(totalSources * (lib.weight / totalWeight))
        : Math.floor(totalSources / libraries.length),
  }));
};

// Retrieves documents from a specific library using vector similarity search
// Supports additional filtering beyond library selection
async function retrieveDocumentsByLibrary(
  retriever: VectorStoreRetriever,
  libraryName: string,
  k: number,
  query: string,
  baseFilter?: Record<string, unknown>
): Promise<Document[]> {
  const libraryFilter = { library: libraryName };

  let finalFilter: Record<string, unknown>;
  if (baseFilter) {
    // Cleaner approach to merge filters with $and
    if ("$and" in baseFilter) {
      // If baseFilter already has $and, just add our library filter to it
      finalFilter = {
        ...baseFilter,
        $and: [...(baseFilter.$and as Array<Record<string, unknown>>), libraryFilter],
      };
    } else {
      // Otherwise create a new $and array with both filters
      finalFilter = {
        $and: [baseFilter, libraryFilter],
      };
    }
  } else {
    finalFilter = libraryFilter;
  }

  const documents = await retriever.vectorStore.similaritySearch(query, k, finalFilter);

  return documents;
}

/**
 * Detects if a question has location-related intent
 * @param question - The user's question
 * @returns boolean indicating if location tools should be used
 */
export function hasLocationIntent(question: string): boolean {
  const locationKeywords = [
    // Direct location queries
    "near me",
    "nearby",
    "closest",
    "nearest",
    "in my area",
    "around here",
    "where can i find",
    "where is",
    "where are",
    "location of",
    "find a",
    // Center-specific queries
    "center near",
    "group near",
    "community near",
    "meeting near",
    "ananda center",
    "meditation center",
    "spiritual center",
    // Geographic references
    "directions to",
    "address of",
    // Distance queries
    "how far",
    "miles from",
    "drive to",
    "travel to",
  ];

  const questionLower = question.toLowerCase();

  // Check for explicit location keywords
  const hasKeywords = locationKeywords.some((keyword) => questionLower.includes(keyword.trim()));

  // Check for pattern: "center in [location]" or "group in [location]"
  // but make it more specific to avoid false matches
  const locationPattern = /(center|group|community|meeting|class)\s+(in|at|near)\s+([A-Z][a-z]+|[a-z]+\s+[A-Z][a-z]+)/i;
  const hasLocationPattern = locationPattern.test(question);

  // Check for "near" followed by a proper noun (likely a location) but be more restrictive
  // Only match if "near" is followed by a capitalized word that looks like a place name
  const nearLocationPattern = /\bnear\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*/;
  const hasNearLocation = nearLocationPattern.test(question);

  // Additional check: if question contains "in" followed by what looks like a place name
  const inLocationPattern = /\bin\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/;
  const hasInLocation =
    inLocationPattern.test(question) &&
    // But exclude common phrases that aren't locations
    !/(in\s+general|in\s+particular|in\s+this|in\s+that|in\s+life|in\s+mind|in\s+heart|in\s+spirit)/i.test(
      questionLower
    );

  return hasKeywords || hasLocationPattern || hasNearLocation || hasInLocation;
}

// Main chain creation function that sets up the complete conversational QA system
// Supports multiple models, weighted library access, and site-specific configurations
export const makeChain = async (
  retriever: VectorStoreRetriever,
  modelConfig: ModelConfig,
  sourceCount: number = 4,
  baseFilter?: Record<string, unknown>,
  sendData?: (data: StreamingResponseData) => void,
  resolveDocs?: (docs: Document[]) => void,
  rephraseModelConfig: ModelConfig = {
    model: "gpt-3.5-turbo",
    temperature: 0.1,
  },
  privateSession: boolean = false,
  geoTools: any[] = [],
  request?: NextRequest,
  siteConfig?: AppSiteConfig | null,
  originalQuestion?: string // Add this parameter to pass the original question
) => {
  const { model, temperature, label } = modelConfig;
  let answerModel: BaseLanguageModel; // Renamed for clarity
  let rephraseModel: BaseLanguageModel; // New model for rephrasing

  // Get site ID from siteConfig if available
  const siteId = siteConfig?.siteId || process.env.SITE_ID;
  if (!siteId) {
    throw new Error("Site ID is required but not provided in siteConfig or SITE_ID environment variable");
  }

  // Get included libraries from siteConfig if available
  const includedLibraries: Array<string | { name: string; weight?: number }> = siteConfig?.includedLibraries || [];

  try {
    // Initialize the answer generation model
    const baseAnswerModel = new ChatOpenAI({
      temperature,
      modelName: model,
      streaming: true,
    });

    // ✅ CONDITIONAL TOOL BINDING: Only bind geo tools if location intent is detected
    const shouldUseGeoTools = originalQuestion && hasLocationIntent(originalQuestion);

    if (shouldUseGeoTools && geoTools.length > 0 && request) {
      // Bind tools to the model - LangChain will handle tool execution automatically
      answerModel = baseAnswerModel.bind({
        tools: geoTools,
        tool_choice: "auto", // Let AI decide when to use tools
      }) as BaseLanguageModel;

      console.log(
        "✅ Geo-awareness tools conditionally bound to OpenAI model for location query:",
        originalQuestion?.substring(0, 100)
      );
    } else {
      answerModel = baseAnswerModel as BaseLanguageModel;

      if (originalQuestion) {
        console.log("🔍 GEO DEBUG: No location intent detected in question:", originalQuestion?.substring(0, 100));
      }
    }

    // Initialize the rephrasing model (faster, lighter)
    rephraseModel = new ChatOpenAI({
      temperature: rephraseModelConfig.temperature,
      modelName: rephraseModelConfig.model,
      streaming: false, // No need for streaming here
    }) as BaseLanguageModel;
  } catch (error) {
    const errorMsg = `Failed to initialize models: ${error}`;
    console.error(errorMsg, error);
    if (sendData) sendData({ log: errorMsg });

    // Send ops alert for OpenAI model initialization failures
    try {
      const errorString = error instanceof Error ? error.message : String(error);

      // Check if this is a quota/billing related error
      const isQuotaError =
        errorString.includes("429") ||
        errorString.includes("quota") ||
        errorString.includes("billing") ||
        errorString.includes("insufficient_quota") ||
        errorString.includes("rate_limit");

      if (isQuotaError) {
        await sendOpsAlert(
          `CRITICAL: OpenAI API Quota/Billing Issue`,
          `OpenAI model initialization failed due to quota or billing issues.

This prevents the system from:
- Initializing chat models for response generation
- Processing user queries
- Generating embeddings
- All AI-powered functionality

Models affected:
- Answer model: ${model} (temperature: ${temperature})
- Rephrase model: ${rephraseModelConfig.model} (temperature: ${rephraseModelConfig.temperature})

IMMEDIATE ACTION REQUIRED:
1. Check OpenAI account billing status
2. Verify payment methods and account standing
3. Review and increase quota limits if needed
4. Check API key permissions and validity

Error details: ${errorString}`,
          {
            error: error instanceof Error ? error : new Error(String(error)),
            context: {
              errorType: "openai_model_init_quota_failure",
              answerModel: model,
              rephraseModel: rephraseModelConfig.model,
              temperature,
              rephraseTemperature: rephraseModelConfig.temperature,
              label,
              timestamp: new Date().toISOString(),
              operation: "makeChain_model_initialization",
            },
          }
        );
      } else {
        await sendOpsAlert(
          `CRITICAL: OpenAI Model Initialization Failure`,
          `OpenAI model initialization failed during chain setup.

This prevents the system from:
- Creating language model chains
- Processing user queries
- Generating AI responses
- All chat functionality

Models affected:
- Answer model: ${model} (temperature: ${temperature})
- Rephrase model: ${rephraseModelConfig.model} (temperature: ${rephraseModelConfig.temperature})

IMMEDIATE ACTION REQUIRED:
1. Check OpenAI API service status
2. Verify API keys and configuration
3. Check network connectivity to OpenAI endpoints
4. Review model availability and permissions

Error details: ${errorString}`,
          {
            error: error instanceof Error ? error : new Error(String(error)),
            context: {
              errorType: "openai_model_init_failure",
              answerModel: model,
              rephraseModel: rephraseModelConfig.model,
              temperature,
              rephraseTemperature: rephraseModelConfig.temperature,
              label,
              timestamp: new Date().toISOString(),
              operation: "makeChain_model_initialization",
            },
          }
        );
      }
    } catch (emailError) {
      console.error("Failed to send OpenAI model initialization ops alert:", emailError);
    }

    throw new Error(`Model initialization failed for ${label || model}`);
  }

  const condenseQuestionPrompt = ChatPromptTemplate.fromTemplate(CONDENSE_TEMPLATE);
  const fullTemplate = await getFullTemplate(siteId);
  const templateWithReplacedVars = fullTemplate.replace(
    /\${(context|chat_history|question)}/g,
    (match, key) => `{${key}}`
  );
  const answerPrompt = ChatPromptTemplate.fromTemplate(`{context}\n\n${templateWithReplacedVars}`);

  // Rephrase the initial question into a dereferenced standalone question based on
  // the chat history to allow effective vectorstore querying.
  // Use the faster rephraseModel for standalone question generation
  const standaloneQuestionChain = RunnableSequence.from([condenseQuestionPrompt, rephraseModel]);

  // Track libraries we've already logged to prevent duplicates
  const loggedLibraries = new Set<string>();

  // Runnable sequence for retrieving documents
  const retrievalSequence = RunnableSequence.from([
    async (input: AnswerChainInput) => {
      const allDocuments: Document[] = [];
      try {
        if (sendData) sendData({ log: `[RAG] Retrieving documents: requested=${sourceCount}` });
        // If no libraries specified or they don't have weights, use a single query
        if (!includedLibraries || includedLibraries.length === 0) {
          const docs = await retriever.vectorStore.similaritySearch(input.question, sourceCount, baseFilter);
          allDocuments.push(...docs);
        } else {
          // Check if we have weights
          const hasWeights = includedLibraries.some((lib) => typeof lib === "object" && lib !== null);

          if (hasWeights) {
            // Use the weighted distribution with parallel queries only when we have weights
            const sourcesDistribution = calculateSources(
              sourceCount,
              includedLibraries as { name: string; weight?: number }[]
            );
            if (sendData)
              sendData({ log: `[RAG] Weighted source distribution: ${JSON.stringify(sourcesDistribution)}` });
            const retrievalPromises = sourcesDistribution
              .filter(({ sources }) => sources > 0)
              .map(async ({ name, sources }) => {
                try {
                  const docs = await retrieveDocumentsByLibrary(retriever, name, sources, input.question, baseFilter);
                  if (sendData) sendData({ log: `[RAG] Retrieved ${docs.length} docs from library: ${name}` });
                  if (!loggedLibraries.has(name)) {
                    loggedLibraries.add(name);
                  }
                  return docs;
                } catch (err) {
                  if (sendData) sendData({ log: `[RAG] Error retrieving from library: ${name} ${err}` });
                  return [];
                }
              });

            // Wait for all retrievals to complete in parallel
            const docsArrays = await Promise.all(retrievalPromises);
            docsArrays.forEach((docs) => {
              allDocuments.push(...docs);
            });
          } else {
            // If all libraries have equal weight or no weights, use a single query with library filter
            const libraryNames = includedLibraries.map((lib) => (typeof lib === "string" ? lib : lib.name));
            let finalFilter: Record<string, unknown>;
            const libraryFilter = { library: { $in: libraryNames } };
            if (baseFilter) {
              if ("$and" in baseFilter) {
                finalFilter = {
                  ...baseFilter,
                  $and: [...(baseFilter.$and as Array<Record<string, unknown>>), libraryFilter],
                };
              } else {
                finalFilter = {
                  $and: [baseFilter, libraryFilter],
                };
              }
            } else {
              finalFilter = libraryFilter;
            }
            const docs = await retriever.vectorStore.similaritySearch(input.question, sourceCount, finalFilter);
            if (sendData) sendData({ log: `[RAG] Retrieved ${docs.length} docs from combined libraries` });
            allDocuments.push(...docs);
          }
        }
        if (sendData) sendData({ log: `[RAG] Documents retrieved: found=${allDocuments.length}` });
      } catch (err) {
        if (sendData) sendData({ log: `[RAG] Error retrieving documents: ${err}` });
      }
      if (sendData) {
        // DEBUG: Add extensive logging for sources debugging
        try {
          const debugMsg1 = `🔍 SOURCES DEBUG: Retrieved ${allDocuments.length} documents`;
          console.log(debugMsg1);
          sendData({ log: debugMsg1 });

          // Check for empty documents
          if (allDocuments.length === 0) {
            const warningMsg = `⚠️ SOURCES WARNING: No documents retrieved for question: "${input.question.substring(0, 100)}..."`;
            console.warn(warningMsg);
            sendData({ log: warningMsg });
          }

          // DEBUG: Check for problematic content that could break JSON serialization
          const problematicSources = allDocuments.filter((doc, index) => {
            try {
              JSON.stringify(doc);
              return false;
            } catch (e) {
              const errorMsg1 = `❌ SOURCES ERROR: Document ${index} failed individual serialization: ${e}`;
              console.error(errorMsg1);
              sendData({ log: errorMsg1 });

              const errorMsg2 = `❌ SOURCES ERROR: Problematic document structure: ${JSON.stringify({
                hasPageContent: !!doc.pageContent,
                pageContentLength: doc.pageContent?.length,
                hasMetadata: !!doc.metadata,
                metadataKeys: doc.metadata ? Object.keys(doc.metadata) : [],
                metadataSize: doc.metadata ? JSON.stringify(doc.metadata).length : 0,
              })}`;
              console.error(errorMsg2);
              sendData({ log: errorMsg2 });
              return true;
            }
          });

          if (problematicSources.length > 0) {
            const errorMsg = `❌ SOURCES ERROR: ${problematicSources.length} documents have serialization issues`;
            console.error(errorMsg);
            sendData({ log: errorMsg });
          }

          // Test JSON serialization before sending
          const serializedTest = JSON.stringify(allDocuments);
          const serializedSize = new Blob([serializedTest]).size;
          const debugMsg2 = `🔍 SOURCES DEBUG: Serialized sources size: ${serializedSize} bytes`;
          console.log(debugMsg2);
          sendData({ log: debugMsg2 });

          if (serializedSize > 1000000) {
            // 1MB threshold
            const warningMsg1 = `⚠️ SOURCES WARNING: Large sources payload detected: ${serializedSize} bytes`;
            console.warn(warningMsg1);
            sendData({ log: warningMsg1 });

            const warningMsg2 = `⚠️ SOURCES WARNING: This could cause JSON serialization to fail in SSE transmission`;
            console.warn(warningMsg2);
            sendData({ log: warningMsg2 });
          }

          // Test if sources can be parsed back
          const parseTest = JSON.parse(serializedTest);
          if (!Array.isArray(parseTest) || parseTest.length !== allDocuments.length) {
            const errorMsg = `❌ SOURCES ERROR: Serialization round-trip failed!`;
            console.error(errorMsg);
            sendData({ log: errorMsg });
          } else {
            const successMsg = `✅ SOURCES DEBUG: Serialization test passed`;
            console.log(successMsg);
            sendData({ log: successMsg });
          }

          sendData({ sourceDocs: allDocuments });
          const successMsg2 = `✅ SOURCES DEBUG: Successfully sent ${allDocuments.length} sources to client`;
          console.log(successMsg2);
          sendData({ log: successMsg2 });
        } catch (serializationError) {
          const errorMsg1 = `❌ SOURCES ERROR: Failed to serialize/send sources: ${serializationError}`;
          console.error(errorMsg1);
          sendData({ log: errorMsg1 });

          const errorMsg2 = `❌ SOURCES ERROR: This is likely THE BUG - answer will stream but sources will be missing`;
          console.error(errorMsg2);
          sendData({ log: errorMsg2 });

          const errorMsg3 = `❌ SOURCES ERROR: Error details: ${JSON.stringify({
            name: serializationError instanceof Error ? serializationError.name : "Unknown",
            message: serializationError instanceof Error ? serializationError.message : String(serializationError),
            documentCount: allDocuments.length,
          })}`;
          console.error(errorMsg3);
          sendData({ log: errorMsg3 });
          // Send empty array as fallback
          sendData({ sourceDocs: [] });
        }
      }
      if (resolveDocs) {
        resolveDocs(allDocuments);
      }
      return allDocuments;
    },
    (docs: Document[]) => {
      return {
        documents: docs,
        combinedContent: combineDocumentsFn(docs),
      };
    },
  ]);

  // Generate an answer to the standalone question based on the chat history
  // and retrieved documents. Additionally, we return the source documents directly.

  // Define the input type for the data that goes into the prompt
  type PromptDataType = {
    context: string;
    chat_history: string;
    question: string;
    documents: Document[]; // also include documents for passthrough
  };

  // This chain takes PromptDataType, selects necessary fields for the prompt, and generates a string answer
  const generationChainThatTakesPromptData = RunnableSequence.from([
    (input: PromptDataType) => ({
      context: input.context,
      chat_history: input.chat_history,
      question: input.question,
    }),
    answerPrompt,
    answerModel,
  ]);

  // Chain to prepare input for generationChain and combine its output with sourceDocuments
  const fullAnswerGenerationChain = RunnablePassthrough.assign({
    answer: generationChainThatTakesPromptData, // Use the new chain
    sourceDocuments: (input: PromptDataType) => input.documents, // input here is PromptDataType
  });

  const answerChain = RunnableSequence.from([
    // Step 1: Combine retrieval and original input
    {
      retrievalOutput: retrievalSequence,
      originalInput: new RunnablePassthrough<AnswerChainInput>(),
    },
    // Step 2: Map to the required fields
    (input: {
      retrievalOutput: { combinedContent: string; documents: Document[] };
      originalInput: AnswerChainInput;
    }) => ({
      context: input.retrievalOutput.combinedContent,
      chat_history: input.originalInput.chat_history,
      question: input.originalInput.question,
      documents: input.retrievalOutput.documents, // Pass documents along
    }),
    fullAnswerGenerationChain, // This now takes the mapped input and produces { answer, sourceDocuments }
  ]);

  // Store the restated question in a closure to be accessed later
  let capturedRestatedQuestion = "";

  // Combine all chains into the final conversational retrieval QA chain
  const conversationalRetrievalQAChain = RunnableSequence.from([
    {
      question: async (input: AnswerChainInput) => {
        // Debug: Log the original question only if not in private mode
        if (!privateSession) {
          const debugMsg = `🔍 ORIGINAL QUESTION: "${input.question}"`;
          console.log(debugMsg);
          if (sendData) sendData({ log: debugMsg });
        }

        // Check for social messages like "thanks" and bypass reformulation.
        // This is a fallback to catch the basic cases in case the CONDENSE_TEMPLATE does not handle it correctly.
        const simpleSocialPattern =
          /^(thanks|thank you|gracias|merci|danke|thank|thx|ty|thank u|muchas gracias|vielen dank|great|awesome|perfect|good|nice|ok|okay|got it|perfect|clear)[\s!.]*$/i;
        if (simpleSocialPattern.test(input.question.trim())) {
          capturedRestatedQuestion = input.question; // Store for later
          return input.question; // Don't reformulate social messages
        }

        if (input.chat_history.length === 0) {
          capturedRestatedQuestion = input.question; // Store for later
          return input.question;
        }

        // Get the reformulated standalone question
        const standaloneQuestion = await standaloneQuestionChain.invoke(input);

        // Debug: Show the result of reformulation only if not in private mode
        if (!privateSession) {
          const debugMsg = `🔍 REFORMULATED TO: "${standaloneQuestion}"`;
          console.log(debugMsg);
          if (sendData) sendData({ log: debugMsg });
        }

        capturedRestatedQuestion = standaloneQuestion; // Store for later
        return standaloneQuestion;
      },
      chat_history: (input: AnswerChainInput) => input.chat_history,
    },
    answerChain, // Use the answer chain directly to maintain streaming
    // Add the restated question to the final result
    (result: { answer: string; sourceDocuments: Document[] }) => {
      return {
        ...result,
        question: capturedRestatedQuestion, // This is the restated question
      };
    },
  ]);

  return conversationalRetrievalQAChain;
};

// Creates two parallel chains for comparing responses from different models
// Useful for testing and evaluating model performance
export const makeComparisonChains = async (
  retriever: VectorStoreRetriever,
  modelA: ModelConfig,
  modelB: ModelConfig,
  rephraseModelConfig: ModelConfig = {
    model: "gpt-3.5-turbo",
    temperature: 0.1,
  },
  privateSession: boolean = false,
  siteConfig?: AppSiteConfig | null
) => {
  try {
    const [chainA, chainB] = await Promise.all([
      makeChain(
        retriever,
        { ...modelA, label: "A" },
        undefined,
        undefined,
        undefined,
        undefined,
        rephraseModelConfig,
        privateSession,
        [], // No geo tools for comparison chains
        undefined, // No request for comparison chains
        siteConfig,
        undefined // No original question for comparison chains
      ),
      makeChain(
        retriever,
        { ...modelB, label: "B" },
        undefined,
        undefined,
        undefined,
        undefined,
        rephraseModelConfig,
        privateSession,
        [], // No geo tools for comparison chains
        undefined, // No request for comparison chains
        siteConfig,
        undefined // No original question for comparison chains
      ),
    ]);

    return { chainA, chainB };
  } catch (error) {
    const errorMsg = `Failed to create comparison chains: ${error}`;
    console.error(errorMsg, error);
    throw new Error("Failed to initialize one or both models for comparison");
  }
};

// Export the setupAndExecuteLanguageModelChain function
export async function setupAndExecuteLanguageModelChain(
  retriever: ReturnType<PineconeStore["asRetriever"]>,
  sanitizedQuestion: string,
  history: ChatMessage[],
  sendData: (data: StreamingResponseData) => void,
  sourceCount: number = 4,
  filter?: Record<string, unknown>,
  siteConfig?: AppSiteConfig | null,
  startTime?: number,
  privateSession: boolean = false,
  request?: NextRequest
): Promise<{ fullResponse: string; finalDocs: Document[]; restatedQuestion: string }> {
  const TIMEOUT_MS = process.env.NODE_ENV === "test" ? 1000 : 30000;
  const RETRY_DELAY_MS = process.env.NODE_ENV === "test" ? 10 : 1000;
  const MAX_RETRIES = 3;

  let retryCount = 0;
  let lastError: Error | null = null;
  let tokensStreamed = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      const modelName = siteConfig?.modelName || "gpt-4o";
      const temperature = siteConfig?.temperature || 0.3;
      const rephraseModelName = "gpt-3.5-turbo";
      const rephraseTemperature = 0.1;

      // Send site ID immediately
      if (siteConfig?.siteId) {
        const expectedSiteId = process.env.SITE_ID || "default";

        if (siteConfig.siteId !== expectedSiteId) {
          const error = `Error: Backend is using incorrect site ID: ${siteConfig.siteId}. Expected: ${expectedSiteId}`;
          console.error(error);
          sendData({ log: error });
        }
        sendData({ siteId: siteConfig.siteId });
      }

      // Check if geo-awareness is enabled for this site
      // Note: siteConfig is already the specific site's config from loadSiteConfigSync()
      const isGeoEnabled = siteConfig?.enableGeoAwareness || false;

      // Prepare geo-awareness tools if enabled
      let geoTools: any[] = [];
      if (isGeoEnabled && request) {
        if (sendData) {
          sendData({ log: "[GEO] Geo-awareness tools bound to AI model", toolResponse: true });
        }

        // Import tools dynamically to avoid circular dependencies
        const { TOOL_DEFINITIONS } = await import("./tools");
        geoTools = TOOL_DEFINITIONS;
      } else {
        console.log("🔍 GEO DEBUG: NOT binding tools - isGeoEnabled:", isGeoEnabled, "request:", !!request);
      }

      const chain = await makeChain(
        retriever,
        { model: modelName, temperature },
        sourceCount,
        filter,
        sendData,
        undefined,
        { model: rephraseModelName, temperature: rephraseTemperature },
        privateSession,
        geoTools,
        request,
        siteConfig,
        sanitizedQuestion // Pass original question for intent detection
      );

      // Format chat history for the language model
      const pastMessages = convertChatHistory(history);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let fullResponse = ""; // This will be populated by streaming tokens
      let firstTokenTime: number | null = null;
      let firstByteTime: number | null = null;

      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Operation timed out after ${TIMEOUT_MS}ms`));
        }, TIMEOUT_MS);
      });

      const chainPromise = chain.invoke(
        {
          question: sanitizedQuestion,
          chat_history: pastMessages,
        },
        {
          callbacks: [
            {
              handleLLMNewToken(token: string) {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now();
                  firstByteTime = Date.now();
                  sendData({
                    token,
                    timing: {
                      firstTokenGenerated: firstTokenTime,
                      ttfb: firstByteTime && startTime ? firstByteTime - startTime : undefined,
                    },
                  });
                } else {
                  sendData({ token });
                }
                fullResponse += token;
                tokensStreamed += token.length;
              },
              async handleToolStart(tool: any, input: string) {
                console.log(`🔧 Tool called: ${tool.name} with input: ${JSON.stringify(input)}`);
                if (sendData) {
                  sendData({ log: `[TOOL] Calling ${tool.name}`, toolResponse: true });
                }
              },
              async handleToolEnd(output: string) {
                console.log(`🔧 Tool output: ${output}`);
                if (sendData) {
                  sendData({ log: `[TOOL] Tool execution completed`, toolResponse: true });
                }
              },
              async handleToolError(error: Error) {
                console.error(`🔧 Tool error: ${error.message}`);
                if (sendData) {
                  sendData({ log: `[TOOL] Tool error: ${error.message}`, toolResponse: true });
                }
              },
            } as Partial<BaseCallbackHandler>,
          ],
        }
      );

      // The result from chain.invoke will now be an object { answer: AIMessageChunk, sourceDocuments: Document[], question: string }
      const result = (await Promise.race([chainPromise, timeoutPromise])) as {
        answer: any; // AIMessageChunk object with content property
        sourceDocuments: Document[];
        question: string;
      };

      // Handle tool calls with proper loop
      if (result.answer && result.answer.tool_calls && result.answer.tool_calls.length > 0) {
        console.log("🔧 Starting tool execution loop");

        const { executeTool } = await import("./tools");
        const { ToolMessage } = await import("@langchain/core/messages");

        let currentResponse = result.answer;
        const allToolMessages = [];
        const maxIterations = 5; // Prevent infinite loops
        let iteration = 0;

        while (currentResponse.tool_calls && currentResponse.tool_calls.length > 0 && iteration < maxIterations) {
          iteration++;
          console.log(
            `🔧 Tool execution iteration ${iteration}, processing ${currentResponse.tool_calls.length} tool calls`
          );

          // Execute all tool calls in this iteration
          const toolResults = [];
          for (const toolCall of currentResponse.tool_calls) {
            try {
              console.log(`🔧 Executing tool: ${toolCall.name} with args:`, toolCall.args);
              const toolResult = await executeTool(toolCall.name, toolCall.args, request!);
              toolResults.push({
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResult),
              });
              console.log(`✅ Tool ${toolCall.name} executed successfully:`, toolResult);
            } catch (error) {
              console.error(`❌ Tool ${toolCall.name} failed:`, error);
              toolResults.push({
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
              });
            }
          }

          // Create tool messages for this iteration
          const toolMessages = toolResults.map(
            (result) =>
              new ToolMessage({
                content: result.content,
                tool_call_id: result.tool_call_id,
              })
          );

          allToolMessages.push(...toolMessages);

          // Call OpenAI again with tool results - NO SOURCES to avoid confusion
          console.log(`🔧 Sending tool results back to AI (iteration ${iteration})`);

          // Create a tool-free model for final response (no tools binding)
          const { ChatOpenAI } = await import("@langchain/openai");
          const toolFreeModel = new ChatOpenAI({
            temperature: temperature,
            modelName: modelName,
            streaming: true,
          });

          // Create messages for the tool-free model
          const { HumanMessage, AIMessage, SystemMessage } = await import("@langchain/core/messages");

          // Get the system prompt for the tool-free model
          const systemPrompt = await getFullTemplate(siteConfig?.siteId || "ananda-public");

          // Create a proper conversation structure with system prompt
          const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(sanitizedQuestion),
            new AIMessage({ content: "", tool_calls: currentResponse.tool_calls }),
            ...allToolMessages,
          ];

          // Debug: Log what we're sending to the AI
          console.log(
            "🔧 DEBUG: Tool messages being sent to AI:",
            JSON.stringify(
              allToolMessages.map((msg) => ({
                content: msg.content,
                tool_call_id: msg.tool_call_id,
              })),
              null,
              2
            )
          );

          // Get final response from tool-free model with streaming
          const toolResponse = await toolFreeModel.invoke(messages, {
            callbacks: [
              {
                handleLLMNewToken(token: string) {
                  if (!firstTokenTime) {
                    firstTokenTime = Date.now();
                    firstByteTime = Date.now();
                    sendData({
                      token,
                      timing: {
                        firstTokenGenerated: firstTokenTime,
                        ttfb: firstByteTime && startTime ? firstByteTime - startTime : undefined,
                      },
                    });
                  } else {
                    sendData({ token });
                  }
                  fullResponse += token;
                  tokensStreamed += token.length;
                },
              } as Partial<BaseCallbackHandler>,
            ],
          });

          currentResponse = toolResponse;
          console.log(`✅ Tool response received for iteration ${iteration}`);
        }

        if (iteration >= maxIterations) {
          console.warn(`⚠️ Tool execution loop reached max iterations (${maxIterations})`);
        }

        result.answer = currentResponse;
        console.log(`✅ Tool execution loop completed after ${iteration} iterations`);
      }

      // Add warning logic here, after streaming is complete and result is aggregated
      const resultForDebug = {
        answer: result.answer,
        question: result.question,
      };
      console.log("🔍 DEBUG: result object:", JSON.stringify(resultForDebug, null, 2));
      console.log("🔍 DEBUG: result.answer type:", typeof result.answer);
      console.log("🔍 DEBUG: result.answer value:", result.answer);

      if (
        result.answer &&
        result.answer.content &&
        typeof result.answer.content === "string" &&
        result.answer.content.includes("I don't have any specific information")
      ) {
        const modelInfoForWarning = siteConfig?.modelName || modelName || "unknown"; // Get model name
        const warningMsg = `Warning: AI response from model ${modelInfoForWarning} indicates no relevant information was found for question: "${sanitizedQuestion.substring(0, 100)}..."`;
        console.warn(warningMsg);
        sendData({ log: warningMsg });
        // Optionally, send a warning to the client if needed, though this is after `done:true` has been sent.
        // sendData({ warning: "AI response indicates no relevant information found." });
      }

      const finalTiming: Partial<TimingMetrics> = {};
      if (startTime) {
        finalTiming.totalTime = Date.now() - startTime;
        if (firstByteTime) {
          const streamingTime = finalTiming.totalTime - (firstByteTime - startTime);
          finalTiming.ttfb = firstByteTime - startTime;
          if (streamingTime > 0 && tokensStreamed > 0) {
            finalTiming.tokensPerSecond = Math.round((tokensStreamed / streamingTime) * 1000);
          }
        }
      }
      finalTiming.totalTokens = tokensStreamed;
      if (firstTokenTime) {
        finalTiming.firstTokenGenerated = firstTokenTime;
      }

      sendData({ done: true, timing: finalTiming });
      sendData({ log: "[RAG] Sent done event to frontend" });

      // Use the streamed fullResponse as the authoritative answer since it's what was sent to the frontend
      // result.sourceDocuments are the correctly filtered documents from makeChain.
      // result.question is the restated question from the chain
      return {
        fullResponse: fullResponse || result.answer.content, // Prefer streamed content, fallback to result.answer.content
        finalDocs: result.sourceDocuments,
        restatedQuestion: result.question,
      };
    } catch (error) {
      lastError = error as Error;
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        const warningMsg = `Attempt ${retryCount} failed. Retrying in ${RETRY_DELAY_MS}ms...`;
        console.warn(warningMsg, error);
        sendData({ log: warningMsg });
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        const errorMsg = "All retry attempts failed";
        console.error(errorMsg, error);
        sendData({ log: errorMsg });
        throw lastError;
      }
    }
  }

  throw lastError || new Error("Chain execution failed after retries");
}
