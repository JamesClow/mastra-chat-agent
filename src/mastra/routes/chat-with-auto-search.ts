import { chatRoute } from '@mastra/ai-sdk';
import { extractMessageText, performAutoVectorSearch } from '../hooks/auto-vector-search';

/**
 * Custom chat route handler with automatic vector search
 * 
 * This handler:
 * 1. Intercepts user messages
 * 2. Automatically performs vector search
 * 3. Injects search results into the request context (data field)
 * 4. Uses chatRoute to handle the actual chat with streaming support
 * 
 * Note: This wraps chatRoute to add automatic search functionality.
 * The search results are injected into the request data, which the agent
 * can access via requestContext or the agent can use the vectorSearchTool.
 */
export function createChatRouteWithAutoSearch(agentId: string) {
  // Create the base chatRoute - this will be used as a fallback
  const baseChatRoute = chatRoute({
    path: '/chat',
    agent: agentId,
  });

  // Return a custom route handler that performs search before calling chatRoute
  return {
    path: '/chat',
    method: 'POST' as const,
    handler: async (req: { body: unknown }) => {
      try {
        const body = req.body as {
          messages?: Array<{
            role: string;
            parts?: Array<{ type: string; text?: string; [key: string]: unknown }>;
            text?: string;
            content?: string;
            [key: string]: unknown;
          }>;
          data?: Record<string, unknown>;
        };

        // Extract the last user message
        const messages = body?.messages || [];
        const lastUserMessage = messages
          .filter((msg) => msg.role === 'user')
          .pop();

        // Perform automatic vector search if we have a user message
        if (lastUserMessage) {
          const messageText = extractMessageText(lastUserMessage);
          
          if (messageText.trim().length > 0) {
            try {
              // Get namespace from request context or default to 'public'
              const namespace = (body?.data?.namespace as string) || 'public';
              
              console.log(`[ChatRoute] Performing automatic vector search for user message`);
              const searchResult = await performAutoVectorSearch(messageText, namespace, 5);
              
              // Inject search results into request context
              if (!body.data) {
                body.data = {};
              }
              
              body.data.autoSearchContext = searchResult.context;
              body.data.autoSearchResults = {
                resultCount: searchResult.resultCount,
                hasResults: searchResult.hasResults,
                isNoMatch: searchResult.isNoMatch,
              };
              body.data.autoSearchPerformed = true;

              console.log(`[ChatRoute] Auto search completed: ${searchResult.resultCount} results found`);
            } catch (error) {
              console.error('[ChatRoute] Auto search failed, continuing without search context:', error);
              // Continue without search context - agent can still use vectorSearchTool
              if (!body.data) {
                body.data = {};
              }
              body.data.autoSearchError = error instanceof Error ? error.message : 'Unknown error';
            }
          }
        }

        // Update the request body with search results
        req.body = body;

        // Try to use the base chatRoute handler
        // chatRoute returns a route config object with a handler property
        if (baseChatRoute && typeof baseChatRoute === 'object' && 'handler' in baseChatRoute && typeof baseChatRoute.handler === 'function') {
          return await baseChatRoute.handler(req);
        } else if (typeof baseChatRoute === 'function') {
          // If chatRoute returns a function directly, call it
          return await baseChatRoute(req);
        } else {
          // Fallback: If we can't use chatRoute, we'll need to handle it differently
          // For now, throw an error to indicate the issue
          throw new Error('Unable to access chatRoute handler. Please check Mastra chatRoute implementation.');
        }
      } catch (error) {
        console.error('[ChatRoute] Error in chat route with auto search:', error);
        throw error;
      }
    },
  };
}
