import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPineconeIndex } from '../../pinecone/client';

/**
 * Vector search tool for RAG (Retrieval-Augmented Generation) in Mastra
 * 
 * Searches Pinecone index for relevant documents and returns context
 * for the agent to use in generating responses.
 */
export const vectorSearchTool = createTool({
  id: 'vector-search',
  description: 'Search the knowledge base for relevant information using semantic search. Use this when you need to find information from stored documents, policies, FAQs, or other knowledge base content.',
  inputSchema: z.object({
    query: z.string().describe('The search query to find relevant information'),
    namespace: z.string().optional().describe('Namespace to search in (e.g., "__default__", "public", "restricted", "user_123"). Defaults to "__default__"'),
    topK: z.number().optional().default(5).describe('Number of results to return (default: 5)'),
  }),
  outputSchema: z.object({
    context: z.string().describe('Formatted context from search results for use in responses'),
    results: z.array(z.object({
      id: z.string(),
      score: z.number(),
      content: z.string(),
      metadata: z.record(z.unknown()).optional(),
    })),
    resultCount: z.number(),
    hasResults: z.boolean().describe('Whether any results were found'),
    isNoMatch: z.boolean().describe('True when no results found (knowledge gap)'),
  }),
  execute: async (input) => {
    const { query, namespace = '__default__', topK = 5 } = input;
    
    // Validate environment variables before attempting search
    if (!process.env.PINECONE_API_KEY) {
      const errorMsg = 'PINECONE_API_KEY environment variable is not set. Please configure it in your Mastra Cloud deployment settings.';
      console.error('[VectorSearch]', errorMsg);
      throw new Error(errorMsg);
    }

    const indexName = process.env.PINECONE_INDEX || 'default-index';
    console.log(`[VectorSearch] Searching index: ${indexName}, namespace: ${namespace}, query: "${query.substring(0, 100)}${query.length > 100 ? '...' : ''}"`);

    // Validate query
    if (!query || query.trim().length === 0) {
      console.warn('[VectorSearch] Empty query provided');
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
      console.error('[VectorSearch]', errorMsg, error);
      throw new Error(errorMsg);
    }

    try {
      // Try searchRecords first (for indexes with integrated embeddings)
      // The index might have integrated embeddings but data uploaded as vectors
      // In that case, searchRecords might work but return empty results
      let results: any;
      let hits: Array<{ _id: string; _score: number; fields?: Record<string, any>; metadata?: Record<string, any> }> = [];
      
      try {
        // Try the new Records API - this works if index has integrated embeddings
        results = await index.namespace(namespace).searchRecords({
          query: {
            topK: topK * 2,
            inputs: {
              text: query,
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
        
        hits = results.result.hits || [];
        
        // If we got results but they don't have content in fields, check metadata
        // This handles the case where data was uploaded as vectors but index supports records
        if (hits.length > 0) {
          console.log(`[VectorSearch] searchRecords returned ${hits.length} results`);
        } else {
          console.warn(`[VectorSearch] searchRecords returned 0 results - data might be stored as vectors, not records`);
        }
      } catch (recordsError) {
        console.warn('[VectorSearch] searchRecords failed:', recordsError instanceof Error ? recordsError.message : 'Unknown error');
        // If searchRecords fails completely, the index might not support it
        // We'll return empty results and log the issue
        hits = [];
      }

      // Format results for agent context
      // Handle both Records API format (fields) and Vector API format (metadata)
      const context = hits
        .map((hit) => {
          // Try to get content from fields (Records API) or metadata (Vector API)
          const fields = (hit.fields || {}) as Record<string, any>;
          const metadata = (hit.metadata || {}) as Record<string, any>;
          
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

      const resultCount = hits.length;
      const hasResults = resultCount > 0;
      const isNoMatch = !hasResults;

      console.log(`[VectorSearch] Found ${resultCount} results for query`);
      
      // If no results, log diagnostic information
      if (!hasResults) {
        console.warn(`[VectorSearch] No results found. Diagnostics:`, {
          indexName,
          namespace,
          query: query.substring(0, 50),
          topK: topK * 2,
          suggestion: 'Possible issues: 1) Index has data but format mismatch (vectors vs records), 2) Namespace is incorrect, 3) Index doesn\'t support integrated embeddings. Check if documents were uploaded using upsertRecords (with content field) or vectors API (with metadata only).',
        });
      }

      return {
        context,
        results: hits.map((hit) => {
          const fields = (hit.fields || {}) as Record<string, any>;
          const metadata = (hit.metadata || {}) as Record<string, any>;
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
      
      const fullError = `Vector search failed: ${errorMessage}.${diagnosticInfo} Index: ${indexName}, Namespace: ${namespace}`;
      console.error('[VectorSearch]', fullError, error);
      throw new Error(fullError);
    }
  },
});
