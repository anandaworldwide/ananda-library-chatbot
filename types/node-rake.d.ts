declare module 'node-rake' {
  /**
   * Extracts keywords from text using RAKE (Rapid Automatic Keyword Extraction) algorithm
   */
  export function extract(
    text: string,
    options?: any,
  ): Array<{ phrase: string; score: number }>;

  /**
   * Generates keywords from text using RAKE algorithm (returns just the phrases without scores)
   */
  export function generate(text: string, options?: any): string[];

  /**
   * Default export of node-rake module
   */
  const nodeRake: {
    extract: typeof extract;
    generate: typeof generate;
  };

  export default nodeRake;
}
