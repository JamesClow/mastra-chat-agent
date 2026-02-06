import { getPineconeIndex } from '../../pinecone/client';

/**
 * Automatic vector search hook
 * 
 * Performs vector search on user messages and returns context
 * that can be injected into the agent's conversation.
 */
export async function performAutoVectorSearch(
  userMessage: string,
  namespace: string = '__default__',
  topK: number = 5
): Promise<{
  context: string;
  results: Array<{
    id: string;
    score: number;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  resultCount: number;
  hasResults: boolean;
  isNoMatch: boolean;
}> {
  // Validate environment variables
  if (!process.env.PINECONE_API_KEY) {
    const errorMsg = 'PINECONE_API_KEY environment variable is not set. Please configure it in your Mastra Cloud deployment settings.';
    console.error('[AutoVectorSearch]', errorMsg);
    throw new Error(errorMsg);
  }

  const indexName = process.env.PINECONE_INDEX || 'default-index';
  console.log(`[AutoVectorSearch] Searching index: ${indexName}, namespace: ${namespace}, query: "${userMessage.substring(0, 100)}..."`);

  // Validate query
  if (!userMessage || userMessage.trim().length === 0) {
    console.warn('[AutoVectorSearch] Empty query provided');
    return {
      context: '',
      results: [],
      resultCount: 0,
      hasResults: false,
      isNoMatch: true,
    };
  }

  let index;
  try {
    index = getPineconeIndex();
  } catch (error) {
    const errorMsg = `Failed to initialize Pinecone client: ${error instanceof Error ? error.message : 'Unknown error'}. Check PINECONE_API_KEY configuration.`;
    console.error('[AutoVectorSearch]', errorMsg, error);
    throw new Error(errorMsg);
  }

  try {
    // Search with reranking for best results (best practice)
    // Try searchRecords - works if index has integrated embeddings
    const results = await index.namespace(namespace).searchRecords({
      query: {
        topK: topK * 2, // Get more candidates for reranking
        inputs: {
          text: userMessage,
        },
      },
      rerank: {
        model: 'bge-reranker-v2-m3',
        topN: topK,
        // Use 'text' field (matches field_map from index creation)
        // Note: bge-reranker-v2-m3 only supports one rank field
        rankFields: ['text'],
      },
    });

    // Format results for agent context
    // Records API returns data in 'fields', not 'metadata'
    const context = results.result.hits
      .map((hit) => {
        const fields = (hit.fields || {}) as Record<string, any>;
        // Records API may have metadata as a property, but type doesn't include it
        const metadata = ((hit as any).metadata || {}) as Record<string, any>;
        
        // Extract content - records use 'text' field (matches field_map from index creation)
        const content = String(
          fields.text ||
          fields.content || 
          fields.excerpt ||
          metadata.excerpt || 
          metadata.content || 
          metadata.text ||
          ''
        );
        const score = hit._score;
        const id = hit._id;
        const title = String(metadata.title || fields.title || 'Untitled');

        return `[Document: ${title}, ID: ${id}, Score: ${score.toFixed(3)}]\n${content}`;
      })
      .join('\n\n---\n\n');

    const resultCount = results.result.hits.length;
    const hasResults = resultCount > 0;
    const isNoMatch = !hasResults;

    console.log(`[AutoVectorSearch] Found ${resultCount} results for query`);

    return {
      context,
      results: results.result.hits.map((hit) => {
        const fields = (hit.fields || {}) as Record<string, any>;
        // Records API may have metadata as a property, but type doesn't include it
        const metadata = ((hit as any).metadata || {}) as Record<string, any>;
        return {
          id: hit._id,
          score: hit._score,
          content: String(
            fields.text ||
            fields.content || 
            fields.excerpt ||
            metadata.excerpt || 
            metadata.content || 
            metadata.text ||
            ''
          ),
          metadata: { ...fields, ...metadata },
        };
      }),
      resultCount,
      hasResults,
      isNoMatch,
    };
  } catch (error) {
    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const indexName = process.env.PINECONE_INDEX || 'default-index';
    
    // Check for common error patterns
    let diagnosticInfo = '';
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      diagnosticInfo = ` Index "${indexName}" may not exist. Verify the index name in PINECONE_INDEX environment variable.`;
    } else if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('unauthorized')) {
      diagnosticInfo = ' Check that PINECONE_API_KEY is correct and has proper permissions.';
    } else if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
      diagnosticInfo = ' Check network connectivity and Pinecone service status.';
    }
    
    const fullError = `Auto vector search failed: ${errorMessage}.${diagnosticInfo} Index: ${indexName}, Namespace: ${namespace}`;
    console.error('[AutoVectorSearch]', fullError, error);
    throw new Error(fullError);
  }
}

/**
 * Extracts text content from a message
 * Supports AI SDK UI message format
 */
export function extractMessageText(message: {
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  text?: string;
  [key: string]: unknown;
}): string {
  // If message has direct text property
  if (message.text) {
    return message.text;
  }

  // If message has parts array
  if (message.parts && Array.isArray(message.parts)) {
    const textParts = message.parts
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text as string);
    return textParts.join(' ');
  }

  return '';
}
