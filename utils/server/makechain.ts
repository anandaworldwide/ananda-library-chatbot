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
import { PineconeStore } from '@langchain/pinecone';
import { StreamingResponseData } from '@/types/StreamingResponseData';

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

interface SiteConfig {
  variables: Record<string, string>;
  templates: Record<string, TemplateContent>;
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

  console.log(
    'Final filter in retrieveDocumentsByLibrary:',
    JSON.stringify(finalFilter),
  );
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
  modelConfig: ModelConfig = { model: 'gpt-4o', temperature: 0.3 },
  sourceCount: number = 4,
  baseFilter?: Record<string, unknown>,
  sendData?: (data: StreamingResponseData) => void,
  resolveDocs?: (docs: Document[]) => void,
) => {
  const pineconeStore = retriever.vectorStore as PineconeStore;
  console.log('Retriever pre-set filter:', pineconeStore.filter);
  const { model, temperature: modelTemperature, label } = modelConfig;
  const siteId = process.env.SITE_ID || 'default';

  const configPath = path.join(process.cwd(), 'site-config/config.json');
  const siteConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const temperature = siteConfig[siteId]?.temperature ?? modelTemperature;
  let languageModel: BaseLanguageModel;

  // Normalizes includedLibraries from site config: converts string library names to objects
  // with default weight 1, while preserving weighted objects for proportional source retrieval.
  const rawIncludedLibraries: Array<
    string | { name: string; weight?: number }
  > = siteConfig[siteId]?.includedLibraries || [];
  const includedLibraries = rawIncludedLibraries.map((lib) =>
    typeof lib === 'string' ? { name: lib, weight: 1 } : lib,
  );
  const sourcesDistribution = calculateSources(sourceCount, includedLibraries);

  try {
    // Initialize the language model
    languageModel = new ChatOpenAI({
      temperature,
      modelName: model,
      streaming: true,
    }) as BaseLanguageModel;

    console.log(
      `Initialized model ${label || model} with temperature ${temperature}`,
    );
  } catch (error) {
    console.error(`Failed to initialize model ${model}:`, error);
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
  const standaloneQuestionChain = RunnableSequence.from([
    condenseQuestionPrompt,
    languageModel,
    new StringOutputParser(),
  ]);

  // Runnable sequence for retrieving documents
  const retrievalSequence = RunnableSequence.from([
    async (input: AnswerChainInput) => {
      const allDocuments: Document[] = [];
      if (!includedLibraries || includedLibraries.length === 0) {
        const docs = await retriever.vectorStore.similaritySearch(
          input.question,
          sourceCount,
          baseFilter,
        );
        allDocuments.push(...docs);
      } else {
        for (const { name, sources } of sourcesDistribution) {
          if (sources > 0) {
            const docs = await retrieveDocumentsByLibrary(
              retriever,
              name,
              sources,
              input.question,
              baseFilter,
            );
            allDocuments.push(...docs);
          }
        }
      }
      // Send the documents as soon as they are retrieved
      if (sendData) {
        sendData({ sourceDocs: allDocuments });
      }
      if (resolveDocs) {
        resolveDocs(allDocuments);
      }
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
      }) => {
        console.log(
          'Sources being used for generation:',
          JSON.parse(input.retrievalOutput.combinedContent).map(
            (doc: { id: string; library: string; content: string }) => ({
              id: doc.id,
              library: doc.library,
              content: doc.content.substring(0, 100) + '...',
            }),
          ),
        );
        return input.retrievalOutput.combinedContent;
      },
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
    languageModel,
    new StringOutputParser(),
  ]);

  // Combine all chains into the final conversational retrieval QA chain
  const conversationalRetrievalQAChain = RunnableSequence.from([
    {
      question: (input: AnswerChainInput) => {
        if (input.chat_history.trim() === '') {
          return input.question; // Use original question if no chat history
        }
        return standaloneQuestionChain.invoke(input);
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
) => {
  try {
    const [chainA, chainB] = await Promise.all([
      makeChain(retriever, { ...modelA, label: 'A' }),
      makeChain(retriever, { ...modelB, label: 'B' }),
    ]);

    return { chainA, chainB };
  } catch (error) {
    console.error('Failed to create comparison chains:', error);
    throw new Error('Failed to initialize one or both models for comparison');
  }
};
