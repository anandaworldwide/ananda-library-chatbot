let cachedQueries: Record<string, Record<string, string[]>> | null = null;

export async function loadQueries(siteId: string, collection: string): Promise<string[]> {
  if (cachedQueries && cachedQueries[siteId] && cachedQueries[siteId][collection]) {
    return cachedQueries[siteId][collection];
  }

  try {
    const response = await fetch(`/data/${siteId}/${collection}_queries.txt`);

    if (!response.ok) {
      // Return a helpful message when the file doesn't exist
      const fallbackQueries = ["(Suggested queries not set up yet)"];

      if (!cachedQueries) {
        cachedQueries = {};
      }
      if (!cachedQueries[siteId]) {
        cachedQueries[siteId] = {};
      }
      cachedQueries[siteId][collection] = fallbackQueries;

      return fallbackQueries;
    }

    const text = await response.text();
    const queries = text.split("\n").filter((query) => query.trim() !== "");

    if (!cachedQueries) {
      cachedQueries = {};
    }
    if (!cachedQueries[siteId]) {
      cachedQueries[siteId] = {};
    }
    cachedQueries[siteId][collection] = queries;

    return queries;
  } catch (error) {
    // Handle any other errors (network issues, etc.)
    console.error(`Error loading queries for ${siteId}/${collection}:`, error);
    const fallbackQueries = ["(Suggested queries not set up yet)"];

    if (!cachedQueries) {
      cachedQueries = {};
    }
    if (!cachedQueries[siteId]) {
      cachedQueries[siteId] = {};
    }
    cachedQueries[siteId][collection] = fallbackQueries;

    return fallbackQueries;
  }
}

export async function getCollectionQueries(siteId: string, collectionConfig: Record<string, string>) {
  if (cachedQueries && cachedQueries[siteId]) {
    return cachedQueries[siteId];
  }

  const queries: Record<string, string[]> = {};
  for (const [key] of Object.entries(collectionConfig)) {
    queries[key] = await loadQueries(siteId, key);
  }

  if (!cachedQueries) {
    cachedQueries = {};
  }
  cachedQueries[siteId] = queries;
  return queries;
}
