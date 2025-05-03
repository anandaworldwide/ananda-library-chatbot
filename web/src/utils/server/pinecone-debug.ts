/**
 * Debug utilities for Pinecone queries
 *
 * This file contains functions to help debug and compare Pinecone query results
 * between the website and the Python labeling tool.
 *
 * How to use:
 * 1. Import these functions in route.ts and/or makechain.ts
 * 2. Call them at appropriate places in the code
 * 3. Check the console logs for detailed information
 */

/**
 * Logs detailed query information before executing a Pinecone query
 */
export function logPineconeQuery(
  query: string,
  filter: Record<string, any>,
  topK: number,
  embeddingDimension: number,
  modelName: string = 'text-embedding-ada-002',
) {
  console.log('\n===== DEBUG: WEBSITE PINECONE QUERY DETAILS =====');
  console.log(`Query text: ${query}`);
  console.log(`Top-K: ${topK}`);
  console.log(`Filter: ${JSON.stringify(filter, null, 2)}`);
  console.log(`Embedding model: ${modelName}`);
  console.log(`Embedding dimension: ${embeddingDimension}`);
  console.log('================================================\n');
}

/**
 * Logs detailed information about Pinecone query results
 */
export function logPineconeResults(results: any[], label: string = 'WEBSITE') {
  console.log(`\n===== DEBUG: ${label} PINECONE RESULTS =====`);
  console.log(`Number of matches: ${results.length}`);

  results.forEach((match, i) => {
    console.log(
      `\nMatch #${i + 1} (score: ${match.score?.toFixed(4) || 'N/A'}, id: ${match.id || match.metadata?.id || 'N/A'})`,
    );
    console.log(`Library: ${match.metadata?.library || 'UNKNOWN'}`);
    console.log(`Type: ${match.metadata?.type || 'UNKNOWN'}`);
    console.log(`Author: ${match.metadata?.author || 'UNKNOWN'}`);
    console.log(`Title: ${match.metadata?.title || 'UNKNOWN'}`);

    // Print the first 100 chars of text
    const text = match.pageContent || match.metadata?.text || '';
    const textPreview =
      text.length > 100 ? text.substring(0, 100) + '...' : text;
    console.log(`Text preview: ${textPreview}`);
  });

  console.log('==========================================\n');
}

/**
 * Utility to add temporary debug logging to Pinecone search
 *
 * This is a higher-order function that wraps a Pinecone similaritySearch call
 * with debug logging before and after.
 */
export function withPineconeDebug(
  searchFn: (query: string, k: number, filter?: any) => Promise<any[]>,
  label: string = 'WEBSITE',
) {
  return async (query: string, k: number, filter?: any) => {
    try {
      // Log before query
      console.log(`\n[DEBUG ${label}] Executing Pinecone query: "${query}"`);
      if (filter) {
        console.log(
          `[DEBUG ${label}] With filter: ${JSON.stringify(filter, null, 2)}`,
        );
      }

      // Execute query
      const startTime = Date.now();
      const results = await searchFn(query, k, filter);
      const duration = Date.now() - startTime;

      // Log results
      console.log(
        `[DEBUG ${label}] Query completed in ${duration}ms, returned ${results.length} results`,
      );
      logPineconeResults(results, label);

      return results;
    } catch (error) {
      console.error(`[DEBUG ${label}] Error executing Pinecone query:`, error);
      throw error;
    }
  };
}
