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
    namespace: z.string().optional().describe('Namespace to search in (e.g., "public", "restricted", "user_123"). Defaults to "public"'),
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
  }),
  execute: async (input) => {
    const { query, namespace = 'public', topK = 5 } = input;
    const index = getPineconeIndex();

    try {
      // Search with reranking for best results (best practice)
      const results = await index.namespace(namespace).searchRecords({
        query: {
          topK: topK * 2, // Get more candidates for reranking
          inputs: {
            text: query,
          },
        },
        rerank: {
          model: 'bge-reranker-v2-m3',
          topN: topK,
          rankFields: ['content'], // Adjust based on your field_map
        },
      });

      // Format results for agent context
      const context = results.result.hits
        .map((hit) => {
          const fields = hit.fields as Record<string, any>;
          const content = String(fields?.content ?? '');
          const score = hit._score;
          const id = hit._id;

          return `[Document ${id}, Score: ${score.toFixed(3)}]\n${content}`;
        })
        .join('\n\n---\n\n');

      return {
        context,
        results: results.result.hits.map((hit) => {
          const fields = hit.fields as Record<string, any>;
          return {
            id: hit._id,
            score: hit._score,
            content: String(fields?.content ?? ''),
            metadata: fields,
          };
        }),
        resultCount: results.result.hits.length,
      };
    } catch (error) {
      console.error('Vector search error:', error);
      throw new Error(
        `Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});
