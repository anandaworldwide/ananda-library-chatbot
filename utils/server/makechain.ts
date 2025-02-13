// This file sets up and configures the language model chain for processing chat requests

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

// Helper function to load text from a file
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

async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

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

// Process a template by loading content from a file or using provided content
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

// Replace variables in a template string with their corresponding values
function substituteVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    /\${(\w+)}/g,
    (_, key) => variables[key] || `\${${key}}`,
  );
}

// Load site-specific configuration or fall back to default
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

// Process the site configuration, applying variables and loading templates
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

// Get the full template for the chat prompt, including site-specific configurations
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

// Keep the existing CONDENSE_TEMPLATE for backwards compatibility
const CONDENSE_TEMPLATE = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

<chat_history>
  {chat_history}
</chat_history>

Follow Up Input: {question}
Standalone question:`;

// Function to combine and serialize documents for the language model
const combineDocumentsFn = (docs: Document[]) => {
  const serializedDocs = docs.map((doc) => ({
    content: doc.pageContent,
    metadata: doc.metadata,
    // 9/4/24 MO: Note this was formerly doc.id before estype checking was added. maybe this is
    // going to break?
    id: doc.metadata.id,
    library: doc.metadata.library,
  }));
  return JSON.stringify(serializedDocs);
};

// Add new interface for model config
interface ModelConfig {
  model: string;
  temperature: number;
  label?: string; // For identifying which model in streaming responses
}

// Main function to create the language model chain
export const makeChain = async (
  retriever: VectorStoreRetriever,
  modelConfig: ModelConfig = { model: 'gpt-4o', temperature: 0.3 },
  sourceCount: number = 4,
) => {
  const { model, temperature: modelTemperature, label } = modelConfig;
  const siteId = process.env.SITE_ID || 'default';

  // Load site config to get temperature
  const configPath = path.join(process.cwd(), 'site-config/config.json');
  const siteConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const temperature = siteConfig[siteId]?.temperature ?? modelTemperature;

  // Initialize the language model with error handling
  let languageModel: BaseLanguageModel;
  try {
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

  // Get the full template for the site
  const fullTemplate = await getFullTemplate(siteId);

  // Replace dynamic variables in the template
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

  // Set the number of documents to retrieve
  retriever.k = sourceCount;

  // Create a chain to retrieve and format documents based on a query
  const retrievalChain = RunnableSequence.from([
    (input: string) => {
      return input;
    },
    retriever,
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
    {
      context: RunnableSequence.from([
        new RunnablePassthrough<AnswerChainInput>(),
        async (input: AnswerChainInput) =>
          retrievalChain.invoke(input.question),
        (output: { combinedContent: string }) => output.combinedContent,
      ]),
      chat_history: (input: AnswerChainInput) => input.chat_history,
      question: (input: AnswerChainInput) => input.question,
      documents: RunnableSequence.from([
        new RunnablePassthrough<AnswerChainInput>(),
        async (input: AnswerChainInput) =>
          retrievalChain.invoke(input.question),
        (output: { documents: Document[] }) => output.documents,
      ]),
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
      // Add warning logs with model identification
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

// Add a helper function for creating comparison chains
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
