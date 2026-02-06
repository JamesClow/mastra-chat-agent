import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPineconeIndex } from '../../pinecone/client';

/**
 * Keyword/Lexical search tool for RAG (Retrieval-Augmented Generation) in Mastra
 * 
 * Performs keyword-based lexical search using Pinecone's search capabilities.
 * This is useful when you need to find exact keyword matches or when semantic
 * search doesn't return the desired results.
 */
export const keywordSearchTool = createTool({
  id: 'keyword-search',
  description: 'Search the knowledge base using keyword/lexical search. Use this when you need to find exact keyword matches, specific terms, or when semantic search doesn\'t return the desired results. This is particularly useful for finding specific policy names, document titles, or exact phrases.',
  inputSchema: z.object({
    query: z.string().describe('The search query with keywords to find relevant information'),
    namespace: z.string().optional().describe('Namespace to search in (e.g., "public", "restricted", "user_123"). Defaults to "public"'),
    topK: z.number().optional().default(5).describe('Number of results to return (default: 5)'),
    requiredTerms: z.array(z.string()).optional().describe('Optional list of terms that must be present in the results'),
    useReranking: z.boolean().optional().default(true).describe('Whether to use reranking for better results (default: true)'),
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
    const { query, namespace = 'public', topK = 5, requiredTerms, useReranking = true } = input;
    
    // Validate environment variables before attempting search
    if (!process.env.PINECONE_API_KEY) {
      const errorMsg = 'PINECONE_API_KEY environment variable is not set. Please configure it in your Mastra Cloud deployment settings.';
      console.error('[KeywordSearch]', errorMsg);
      throw new Error(errorMsg);
    }

    const indexName = process.env.PINECONE_INDEX || 'default-index';
    console.log(`[KeywordSearch] Searching index: ${indexName}, namespace: ${namespace}, query: "${query}"`);

    // Validate query
    if (!query || query.trim().length === 0) {
      console.warn('[KeywordSearch] Empty query provided');
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
      console.error('[KeywordSearch]', errorMsg, error);
      throw new Error(errorMsg);
    }

    try {
      // Build query object for lexical search
      // Use type assertion to handle matchTerms type mismatch with Pinecone SDK
      const queryObj: {
        topK: number;
        inputs: { text: string };
        matchTerms?: unknown;
      } = {
        topK: useReranking ? topK * 2 : topK, // Get more candidates if using reranking
        inputs: {
          text: query,
        },
      };

      // Add required terms if specified
      if (requiredTerms && requiredTerms.length > 0) {
        queryObj.matchTerms = requiredTerms;
      }

      // Build search request - use 'as any' to bypass TypeScript's strict typing for matchTerms
      const searchRequest: {
        query: {
          topK: number;
          inputs: { text: string };
          matchTerms?: unknown;
        };
        rerank?: {
          model: string;
          topN: number;
          rankFields: string[];
        };
      } = {
        query: queryObj,
      };

      // Add reranking if requested
      if (useReranking) {
        searchRequest.rerank = {
          model: 'bge-reranker-v2-m3',
          topN: topK,
          // Try both 'content' and 'excerpt' as rank fields since data might use either
          rankFields: ['content', 'excerpt'],
        };
      }

      const results = await index.namespace(namespace).searchRecords(searchRequest as any);

      // Format results for agent context
      // Handle both Records API format (fields) - searchRecords returns fields, not metadata
      const context = results.result.hits
        .map((hit) => {
          const fields = (hit.fields || {}) as Record<string, any>;
          
          // Extract content - try multiple possible field names
          // Note: searchRecords returns data in 'fields', not 'metadata'
          const content = String(
            fields.content || 
            fields.excerpt ||
            ''
          );
          const score = hit._score;
          const id = hit._id;
          const title = String(fields.title || 'Untitled');

          return `[Document: ${title}, ID: ${id}, Score: ${score.toFixed(3)}]\n${content}`;
        })
        .join('\n\n---\n\n');

      const resultCount = results.result.hits.length;
      const hasResults = resultCount > 0;
      const isNoMatch = !hasResults;

      console.log(`[KeywordSearch] Found ${resultCount} results for keyword query`);
      
      // If no results, log diagnostic information
      if (!hasResults) {
        console.warn(`[KeywordSearch] No results found. Diagnostics:`, {
          indexName,
          namespace,
          query: query.substring(0, 50),
          topK: useReranking ? topK * 2 : topK,
          requiredTerms,
          suggestion: 'Check if: 1) Index has data, 2) Namespace is correct, 3) Keywords match indexed content',
        });
      }

      return {
        context,
        results: results.result.hits.map((hit) => {
          const fields = (hit.fields || {}) as Record<string, any>;
          // Note: searchRecords returns data in 'fields', not 'metadata'
          return {
            id: hit._id,
            score: hit._score,
            content: String(
              fields.content || 
              fields.excerpt ||
              ''
            ),
            metadata: fields,
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
      
      const fullError = `Keyword search failed: ${errorMessage}.${diagnosticInfo} Index: ${indexName}, Namespace: ${namespace}`;
      console.error('[KeywordSearch]', fullError, error);
      throw new Error(fullError);
    }
  },
});
