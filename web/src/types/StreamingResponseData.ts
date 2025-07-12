import { Document } from 'langchain/document';

export interface StreamingResponseData {
  token?: string;
  sourceDocs?: Document[];
  done?: boolean;
  error?: string;
  docId?: string;
  model?: string;
  siteId?: string;
  warning?: string;
  timing?: {
    ttfb?: number;
    total?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
    firstTokenGenerated?: number;
  };
  log?: string;
}
