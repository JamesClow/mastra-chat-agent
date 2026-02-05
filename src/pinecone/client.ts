import { Pinecone } from "@pinecone-database/pinecone";

/**
 * Pinecone client singleton for Mastra chat agent
 * 
 * Initialize once and reuse across the application.
 */
let pineconeClient: Pinecone | null = null;

/**
 * Get or create Pinecone client instance
 * 
 * @throws Error if PINECONE_API_KEY is not set
 */
export function getPineconeClient(): Pinecone {
  if (pineconeClient) {
    return pineconeClient;
  }

  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "PINECONE_API_KEY environment variable is required. " +
      "Get your API key from https://app.pinecone.io/"
    );
  }

  pineconeClient = new Pinecone({ apiKey });
  return pineconeClient;
}

/**
 * Get Pinecone index instance
 * 
 * @param indexName - Name of the index (defaults to PINECONE_INDEX env var or "default-index")
 * @returns Index instance
 */
export function getPineconeIndex(indexName?: string) {
  const client = getPineconeClient();
  const name = indexName || process.env.PINECONE_INDEX || "default-index";
  return client.index(name);
}
