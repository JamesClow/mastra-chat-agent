import { chatRoute } from '@mastra/ai-sdk';
import { extractMessageText, performAutoVectorSearch } from '../hooks/auto-vector-search';

/**
 * Extract the JSON body from whatever request object Mastra/Hono passes us.
 * 
 * Mastra uses Hono under the hood, so the `req` parameter is a Hono Context (c).
 * - c.req.json() → parsed JSON body
 * - c.body → method to CREATE a Response (NOT the request body!)
 */
async function extractRequestBody(req: unknown): Promise<Record<string, unknown>> {
  const r = req as Record<string, unknown>;

  // 1. Hono Context: req.req.json()
  if (r.req && typeof r.req === 'object') {
    const honoReq = r.req as Record<string, unknown>;
    if (typeof honoReq.json === 'function') {
      try {
        return await (honoReq.json as () => Promise<Record<string, unknown>>)();
      } catch (error) {
        console.warn('[ChatRoute] Failed to parse via req.req.json():', error);
      }
    }
    if (honoReq.raw && honoReq.raw instanceof Request) {
      try {
        return await honoReq.raw.json() as Record<string, unknown>;
      } catch (error) {
        console.warn('[ChatRoute] Failed to parse via req.req.raw.json():', error);
      }
    }
  }

  // 2. Standard Fetch Request
  if (req instanceof Request) {
    return await req.json() as Record<string, unknown>;
  }

  // 3. Plain object with already-parsed body
  if (r.body && typeof r.body === 'object' && typeof r.body !== 'function') {
    return r.body as Record<string, unknown>;
  }

  // 4. Fallback: return empty object (don't crash the chat)
  console.warn('[ChatRoute] Could not extract request body, continuing without auto-search');
  return {};
}

/**
 * Custom chat route handler with automatic vector search
 * 
 * This handler:
 * 1. Intercepts user messages
 * 2. Automatically performs vector search
 * 3. Injects search results into the request context (data field)
 * 4. Passes through to Mastra's chatRoute for the actual chat with streaming
 */
export function createChatRouteWithAutoSearch(agentId: string) {
  const baseChatRoute = chatRoute({
    path: '/chat',
    agent: agentId,
  });

  return {
    path: '/chat',
    method: 'POST' as const,
    handler: async (req: { body: unknown }) => {
      try {
        // Parse the request body from the Hono Context
        const body = await extractRequestBody(req) as {
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
              const namespace = (body?.data?.namespace as string) || 'public';

              console.log(`[ChatRoute] Performing automatic vector search for: "${messageText.substring(0, 80)}..."`);
              const searchResult = await performAutoVectorSearch(messageText, namespace, 5);

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
              if (!body.data) {
                body.data = {};
              }
              body.data.autoSearchError = error instanceof Error ? error.message : 'Unknown error';
            }
          }
        }

        // Update the request body with search results injected
        req.body = body;

        // Delegate to the base chatRoute handler
        if (baseChatRoute && typeof baseChatRoute === 'object' && 'handler' in baseChatRoute && typeof baseChatRoute.handler === 'function') {
          return await baseChatRoute.handler(req);
        }
        if (typeof baseChatRoute === 'function') {
          return await baseChatRoute(req);
        }
        throw new Error('Unable to access chatRoute handler. Please check Mastra chatRoute implementation.');
      } catch (error) {
        console.error('[ChatRoute] Error in chat route with auto search:', error);
        throw error;
      }
    },
  };
}
