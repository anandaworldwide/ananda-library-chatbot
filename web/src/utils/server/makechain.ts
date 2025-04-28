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

import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  RunnableSequence,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import type { Document } from 'langchain/document';
import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import fs from 'fs/promises';
import path from 'path';
import { BaseLanguageModel } from '@langchain/core/language_models/base';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StreamingResponseData } from '@/types/StreamingResponseData';
import { PineconeStore } from '@langchain/pinecone';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { SiteConfig as AppSiteConfig } from '@/types/siteConfig';
import { ChatMessage, convertChatHistory } from '@/utils/shared/chatHistory';

// S3 client for loading remote templates and configurations
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-1',
});

// Define types and interfaces for the chain input and configuration
type AnswerChainInput = {
  question: string;
  chat_history: string;
};

export type CollectionKey = 'master_swami' | 'whole_library';

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

// Loads text content from local filesystem with error handling
async function loadTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    console.warn(
      `Failed to load file: ${filePath}. Using empty string. (Error: ${error})`,
    );
    return '';
  }
}

// Converts S3 readable stream to string for template loading
async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// Retrieves template content from S3 bucket with error handling
async function loadTextFileFromS3(
  bucket: string,
  key: string,
): Promise<string> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    return await streamToString(response.Body as Readable);
  } catch (error) {
    console.error(`Failed to load from S3: ${bucket}/${key}`, error);
    return '';
  }
}

// Processes a template by either using inline content or loading from file/S3
// Supports variable substitution using the provided variables map
async function processTemplate(
  template: TemplateContent,
  variables: Record<string, string>,
  basePath: string,
): Promise<string> {
  let content = template.content || '';
  if (template.file) {
    if (template.file.toLowerCase().startsWith('s3:'.toLowerCase())) {
      // Load from S3
      if (!process.env.S3_BUCKET_NAME) {
        throw new Error(
          'S3_BUCKET_NAME not configured but s3: file path specified',
        );
      }
      const startTime = Date.now();
      const s3Path = template.file.slice(3); // Remove 's3:' prefix
      content = await loadTextFileFromS3(
        process.env.S3_BUCKET_NAME,
        `site-config/prompts/${s3Path}`,
      );
      console.log(`Loading S3 file took ${Date.now() - startTime}ms`);
    } else {
      // Load from local filesystem
      content = await loadTextFile(path.join(basePath, template.file));
    }
  }
  return substituteVariables(content, variables);
}

// Replaces ${variable} syntax in templates with actual values from variables map
function substituteVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    /\${(\w+)}/g,
    (_, key) => variables[key] || `\${${key}}`,
  );
}

// Loads site-specific configuration with fallback to default config
// Configurations control prompt templates, variables, and model behavior
async function loadSiteConfig(siteId: string): Promise<SiteConfig> {
  const promptsDir =
    process.env.SITE_PROMPTS_DIR ||
    path.join(process.cwd(), 'site-config/prompts');
  const configPath = path.join(promptsDir, `${siteId}.json`);

  try {
    const data = await fs.readFile(configPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(
      `ERROR: Failed to load site-specific config for ${siteId}. Using default. (Error: ${error})`,
    );
    const defaultPath = path.join(promptsDir, 'default.json');
    const defaultData = await fs.readFile(defaultPath, 'utf8');
    return JSON.parse(defaultData);
  }
}

// Processes the entire site configuration, loading all templates and applying variables
async function processSiteConfig(
  config: SiteConfig,
  basePath: string,
): Promise<Record<string, string>> {
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
  const promptsDir =
    process.env.SITE_PROMPTS_DIR ||
    path.join(process.cwd(), 'site-config/prompts');
  const config = await loadSiteConfig(siteId);
  const processedConfig = await processSiteConfig(config, promptsDir);

  // Get the base template
  let fullTemplate = processedConfig.baseTemplate || '';

  // Replace variables from the 'variables' object
  if (config.variables) {
    for (const [key, value] of Object.entries(config.variables)) {
      const placeholder = new RegExp(`\\{${key}\\}`, 'g');
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
const calculateSources = (
  totalSources: number,
  libraries: { name: string; weight?: number }[],
) => {
  if (!libraries || libraries.length === 0) {
    return [];
  }

  const totalWeight = libraries.reduce(
    (sum, lib) => sum + (lib.weight !== undefined ? lib.weight : 1),
    0,
  );
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
  baseFilter?: Record<string, unknown>,
): Promise<Document[]> {
  const libraryFilter = { library: libraryName };

  let finalFilter: Record<string, unknown>;
  if (baseFilter) {
    // Merge baseFilter with libraryFilter using $and
    finalFilter = {
      $and: [baseFilter, libraryFilter],
    };
  } else {
    finalFilter = libraryFilter;
  }

  const documents = await retriever.vectorStore.similaritySearch(
    query,
    k,
    finalFilter,
  );

  return documents;
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
    model: 'gpt-3.5-turbo',
    temperature: 0.1,
  }, // New param for rephrasing model
) => {
  const siteId = process.env.SITE_ID || 'default';
  const configPath = path.join(process.cwd(), 'site-config/config.json');
  const siteConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));

  const { model, temperature, label } = modelConfig;
  let answerModel: BaseLanguageModel; // Renamed for clarity
  let rephraseModel: BaseLanguageModel; // New model for rephrasing

  // If includedLibraries has weights, then preserves weighted objects for proportional source
  // retrieval. Otherwise, it
  const includedLibraries: Array<string | { name: string; weight?: number }> =
    siteConfig[siteId]?.includedLibraries || [];

  try {
    // Initialize the answer generation model
    answerModel = new ChatOpenAI({
      temperature,
      modelName: model,
      streaming: true,
    }) as BaseLanguageModel;

    // Initialize the rephrasing model (faster, lighter)
    rephraseModel = new ChatOpenAI({
      temperature: rephraseModelConfig.temperature,
      modelName: rephraseModelConfig.model,
      streaming: false, // No need for streaming here
    }) as BaseLanguageModel;
  } catch (error) {
    console.error(`Failed to initialize models:`, error);
    throw new Error(`Model initialization failed for ${label || model}`);
  }

  const condenseQuestionPrompt =
    ChatPromptTemplate.fromTemplate(CONDENSE_TEMPLATE);
  const fullTemplate = await getFullTemplate(siteId);
  const templateWithReplacedVars = fullTemplate.replace(
    /\${(context|chat_history|question)}/g,
    (match, key) => `{${key}}`,
  );
  const answerPrompt = ChatPromptTemplate.fromTemplate(
    templateWithReplacedVars,
  );

  // Rephrase the initial question into a dereferenced standalone question based on
  // the chat history to allow effective vectorstore querying.
  // Use the faster rephraseModel for standalone question generation
  const standaloneQuestionChain = RunnableSequence.from([
    condenseQuestionPrompt,
    rephraseModel,
    new StringOutputParser(),
  ]);

  // Track libraries we've already logged to prevent duplicates
  const loggedLibraries = new Set<string>();

  // Runnable sequence for retrieving documents
  const retrievalSequence = RunnableSequence.from([
    async (input: AnswerChainInput) => {
      const retrievalStartTime = Date.now();
      const allDocuments: Document[] = [];

      // If no libraries specified or they don't have weights, use a single query
      if (!includedLibraries || includedLibraries.length === 0) {
        const docs = await retriever.vectorStore.similaritySearch(
          input.question,
          sourceCount,
          baseFilter,
        );
        allDocuments.push(...docs);
      } else {
        // Check if we have weights
        const hasWeights = includedLibraries.some(
          (lib) => typeof lib === 'object' && lib !== null,
        );

        if (hasWeights) {
          // Use the weighted distribution with parallel queries only when we have weights
          // Create an array of retrieval promises to execute in parallel
          const sourcesDistribution = calculateSources(
            sourceCount,
            includedLibraries as { name: string; weight?: number }[],
          );
          const retrievalPromises = sourcesDistribution
            .filter(({ sources }) => sources > 0)
            .map(async ({ name, sources }) => {
              const libraryStartTime = Date.now();
              const docs = await retrieveDocumentsByLibrary(
                retriever,
                name,
                sources,
                input.question,
                baseFilter,
              );

              // Only log each library once to prevent duplication
              if (!loggedLibraries.has(name)) {
                loggedLibraries.add(name);
                console.log(
                  `Library ${name} retrieval took ${Date.now() - libraryStartTime}ms for ${docs.length} documents`,
                );
              }
              return docs;
            });

          // Wait for all retrievals to complete in parallel
          const docsArrays = await Promise.all(retrievalPromises);

          // Combine all document arrays
          docsArrays.forEach((docs) => {
            allDocuments.push(...docs);
          });
        } else {
          // If all libraries have equal weight or no weights, we can use a single query with $or filter
          // This avoids multiple parallel queries when not needed
          const libraryFilters = includedLibraries.map((lib) => ({
            library: lib,
          }));
          let finalFilter: Record<string, unknown>;

          if (baseFilter) {
            finalFilter = {
              $and: [baseFilter, { $or: libraryFilters }],
            };
          } else {
            finalFilter = { $or: libraryFilters };
          }

          const docs = await retriever.vectorStore.similaritySearch(
            input.question,
            sourceCount,
            finalFilter,
          );
          allDocuments.push(...docs);

          // Log library statistics if needed
          includedLibraries.forEach((lib) => {
            const name = typeof lib === 'string' ? lib : lib.name;
            loggedLibraries.add(name);
          });
        }
      }

      // Send the documents as soon as they are retrieved
      if (sendData) {
        sendData({ sourceDocs: allDocuments });
      }
      if (resolveDocs) {
        resolveDocs(allDocuments);
      }
      console.log(
        `Total document retrieval took ${Date.now() - retrievalStartTime}ms for ${allDocuments.length} documents`,
      );
      return allDocuments;
    },
    (docs: Document[]) => {
      if (docs.length === 0) {
        console.warn(`Warning: makeChain: No sources returned for query`);
      }
      return {
        documents: docs,
        combinedContent: combineDocumentsFn(docs),
      };
    },
  ]);

  // Generate an answer to the standalone question based on the chat history
  // and retrieved documents. Additionally, we return the source documents directly.
  const answerChain = RunnableSequence.from([
    // Step 1: Combine retrieval and original input
    {
      retrievalOutput: retrievalSequence,
      originalInput: new RunnablePassthrough<AnswerChainInput>(),
    },
    // Step 2: Map to the required fields
    {
      context: (input: {
        retrievalOutput: { combinedContent: string; documents: Document[] };
        originalInput: AnswerChainInput;
      }) => input.retrievalOutput.combinedContent,
      chat_history: (input: {
        retrievalOutput: { combinedContent: string; documents: Document[] };
        originalInput: AnswerChainInput;
      }) => input.originalInput.chat_history,
      question: (input: {
        retrievalOutput: { combinedContent: string; documents: Document[] };
        originalInput: AnswerChainInput;
      }) => input.originalInput.question,
      documents: (input: {
        retrievalOutput: { combinedContent: string; documents: Document[] };
        originalInput: AnswerChainInput;
      }) => input.retrievalOutput.documents,
    },
    answerPrompt,
    answerModel,
    new StringOutputParser(),
  ]);

  // Combine all chains into the final conversational retrieval QA chain
  const conversationalRetrievalQAChain = RunnableSequence.from([
    {
      question: async (input: AnswerChainInput) => {
        // Debug: Log the original question
        console.log(`🔍 ORIGINAL QUESTION: "${input.question}"`);

        // Check for social messages like "thanks" and bypass reformulation.
        // This is a fallback to catch the basic cases in case the CONDENSE_TEMPLATE does not handle it correctly.
        const simpleSocialPattern =
          /^(thanks|thank you|gracias|merci|danke|thank|thx|ty|thank u|muchas gracias|vielen dank|great|awesome|perfect|good|nice|ok|okay|got it|perfect|clear)[\s!.]*$/i;
        if (simpleSocialPattern.test(input.question.trim())) {
          console.log(
            `🔍 SOCIAL MESSAGE DETECTED: "${input.question}" - bypassing reformulation`,
          );
          return input.question; // Don't reformulate social messages
        }

        if (input.chat_history.trim() === '') {
          console.log(`🔍 NO CHAT HISTORY: Using original question`);
          return input.question; // Use original question if no chat history
        }

        // Debug: Show the question is being sent for reformulation
        console.log(
          `🔍 REFORMULATING QUESTION with chat history of ${input.chat_history.length} characters`,
        );

        // Measure time for the reformulation process
        const reformulationStartTime = Date.now();

        // Get the reformulated standalone question
        const standaloneQuestion = await standaloneQuestionChain.invoke(input);

        // Calculate and log the time taken
        const reformulationTime = Date.now() - reformulationStartTime;
        console.log(
          `⏱️ PERFORMANCE METRIC - Question Reformulation took: ${reformulationTime}ms`,
        );
        console.log(
          `🔧 Using ${rephraseModelConfig.model} for rephrasing (faster model)`,
        );

        // Debug: Show the result of reformulation
        console.log(`🔍 REFORMULATED TO: "${standaloneQuestion}"`);

        return standaloneQuestion;
      },
      chat_history: (input: AnswerChainInput) => input.chat_history,
      modelInfo: () => ({ label, model, temperature }), // Pass model info through
    },
    answerChain,
    (result: string) => {
      if (result.includes("I don't have any specific information")) {
        console.warn(
          `Warning: AI response indicates no relevant information found (${label || model})`,
        );
      }
      return result;
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
    model: 'gpt-3.5-turbo',
    temperature: 0.1,
  },
) => {
  try {
    const [chainA, chainB] = await Promise.all([
      makeChain(
        retriever,
        { ...modelA, label: 'A' },
        undefined,
        undefined,
        undefined,
        undefined,
        rephraseModelConfig,
      ),
      makeChain(
        retriever,
        { ...modelB, label: 'B' },
        undefined,
        undefined,
        undefined,
        undefined,
        rephraseModelConfig,
      ),
    ]);

    return { chainA, chainB };
  } catch (error) {
    console.error('Failed to create comparison chains:', error);
    throw new Error('Failed to initialize one or both models for comparison');
  }
};

// Export the setupAndExecuteLanguageModelChain function
export async function setupAndExecuteLanguageModelChain(
  retriever: ReturnType<PineconeStore['asRetriever']>,
  sanitizedQuestion: string,
  history: ChatMessage[],
  sendData: (data: StreamingResponseData) => void,
  sourceCount: number = 4,
  filter?: Record<string, unknown>,
  resolveDocs?: (docs: Document[]) => void,
  siteConfig?: AppSiteConfig | null,
): Promise<string> {
  try {
    const modelName = siteConfig?.modelName || 'gpt-4o';
    const temperature = siteConfig?.temperature || 0.3;
    const rephraseModelName = 'gpt-3.5-turbo';
    const rephraseTemperature = 0.1;

    // Send site ID immediately and validate
    if (siteConfig?.siteId) {
      const expectedSiteId = process.env.SITE_ID || 'default';

      if (siteConfig.siteId !== expectedSiteId) {
        const error = `Error: Backend is using incorrect site ID: ${siteConfig.siteId}. Expected: ${expectedSiteId}`;
        console.error(error);
      }
      sendData({ siteId: siteConfig.siteId });
    }

    console.log(
      `🔧 Using ${modelName} for answer generation and ${rephraseModelName} for rephrasing`,
    );

    const chainCreationStartTime = Date.now();
    const chain = await makeChain(
      retriever,
      { model: modelName, temperature },
      sourceCount,
      filter,
      sendData,
      resolveDocs,
      { model: rephraseModelName, temperature: rephraseTemperature },
    );
    console.log(`Chain creation took ${Date.now() - chainCreationStartTime}ms`);

    // Format chat history for the language model
    const pastMessages = convertChatHistory(history);

    let fullResponse = '';
    let firstTokenTime: number | null = null;

    // Invoke the chain with callbacks for streaming tokens
    const chainInvocationStartTime = Date.now();
    const chainPromise = chain.invoke(
      {
        question: sanitizedQuestion,
        chat_history: pastMessages,
      },
      {
        callbacks: [
          {
            // Callback for handling new tokens from the language model
            handleLLMNewToken(token: string) {
              if (!firstTokenTime) {
                firstTokenTime = Date.now();
                console.log(
                  `Time to first token: ${firstTokenTime - chainInvocationStartTime}ms`,
                );
                // Send the firstTokenGenerated time with the first token in the timing object
                sendData({
                  token,
                  timing: {
                    firstTokenGenerated: firstTokenTime,
                  },
                });
              } else {
                sendData({ token });
              }
              fullResponse += token;
            },
          } as Partial<BaseCallbackHandler>,
        ],
      },
    );

    // Wait for the chain to complete
    await chainPromise;

    return fullResponse;
  } catch (error) {
    console.error('Error in setupAndExecuteLanguageModelChain:', error);
    throw error;
  }
}
