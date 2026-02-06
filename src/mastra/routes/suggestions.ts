import { generateSuggestions } from '../workflows/suggestion-workflow';

/**
 * Extract the JSON body from whatever request object Mastra/Hono passes us.
 * 
 * Mastra uses Hono under the hood, so the `req` parameter is actually a Hono Context (c).
 * - c.req.json() → parsed JSON body (this is what we need)
 * - c.body → method to CREATE a Response (NOT the request body!)
 * - c.req.raw → the raw Fetch Request
 */
async function extractRequestBody(req: unknown): Promise<unknown> {
  const r = req as Record<string, unknown>;

  // 1. Hono Context: req.req.json() — this is the most likely case in Mastra
  if (r.req && typeof r.req === 'object') {
    const honoReq = r.req as Record<string, unknown>;
    if (typeof honoReq.json === 'function') {
      try {
        return await (honoReq.json as () => Promise<unknown>)();
      } catch (error) {
        console.warn('[SuggestionWorkflow] Failed to parse via req.req.json():', error);
      }
    }
    // Also try req.req.raw (the raw Fetch Request)
    if (honoReq.raw && honoReq.raw instanceof Request) {
      try {
        return await honoReq.raw.json();
      } catch (error) {
        console.warn('[SuggestionWorkflow] Failed to parse via req.req.raw.json():', error);
      }
    }
  }

  // 2. Standard Fetch Request: req.json()
  if (req instanceof Request) {
    try {
      return await req.json();
    } catch {
      const text = await req.text();
      return JSON.parse(text);
    }
  }

  // 3. Plain object with already-parsed body (e.g. { body: { userId: '...' } })
  if (r.body && typeof r.body === 'object' && typeof r.body !== 'function') {
    return r.body;
  }

  // 4. req.json() method (some frameworks expose this)
  if (typeof r.json === 'function' && !('req' in r)) {
    try {
      return await (r.json as () => Promise<unknown>)();
    } catch (error) {
      console.warn('[SuggestionWorkflow] Failed to parse via req.json():', error);
    }
  }

  throw new Error('Unable to extract request body from the provided request object');
}

/**
 * Custom route handler for suggestion workflow
 * POST /workflows/suggestion-workflow
 */
export async function handleSuggestionWorkflow(req: unknown): Promise<{ suggestions: string[] } | Response> {
  try {
    const bodyValue = await extractRequestBody(req);

    // The request body might be the context directly, or wrapped in a body property
    let context = bodyValue;

    // If body is an object with a 'body' property but doesn't have required fields, unwrap it
    if (context && typeof context === 'object' && 'body' in (context as Record<string, unknown>) && !('userId' in (context as Record<string, unknown>))) {
      context = (context as { body: unknown }).body;
    }

    // Validate context structure
    if (!context || typeof context !== 'object') {
      console.error('[SuggestionWorkflow] Invalid context after parsing:', {
        context,
        type: typeof context,
      });
      throw new Error('Invalid context provided. Expected an object with userId, userType, timeOfDay, etc.');
    }

    // Check for required fields to provide better error message
    const contextObj = context as Record<string, unknown>;
    const requiredFields = ['userId', 'userType', 'timeOfDay', 'dayOfWeek', 'dayOfYear', 'isWeekend'];
    const missingFields = requiredFields.filter(field => !(field in contextObj));

    if (missingFields.length > 0) {
      console.error('[SuggestionWorkflow] Missing required fields:', {
        missingFields,
        providedFields: Object.keys(contextObj),
      });
      throw new Error(`Invalid context provided. Missing required fields: ${missingFields.join(', ')}. Provided fields: ${Object.keys(contextObj).join(', ')}`);
    }

    console.log('[SuggestionWorkflow] Context parsed successfully with fields:', Object.keys(contextObj));

    // Execute the workflow step directly
    // Note: We use type assertion here because the step's execute method expects a full context,
    // but in practice it only uses inputData, which we provide
    const result = await (generateSuggestions.execute as (params: { inputData: unknown }) => Promise<{ suggestions: string[] }>)({
      inputData: {
        userId: contextObj.userId as string,
        userType: contextObj.userType as 'guest' | 'regular',
        timeOfDay: contextObj.timeOfDay as 'morning' | 'afternoon' | 'evening' | 'night',
        dayOfWeek: contextObj.dayOfWeek as number,
        dayOfYear: contextObj.dayOfYear as number,
        isWeekend: contextObj.isWeekend as boolean,
        season: contextObj.season as 'spring' | 'summer' | 'fall' | 'winter' | undefined,
        isHoliday: contextObj.isHoliday as boolean | undefined,
        holidayName: contextObj.holidayName as string | undefined,
        chatHistory: contextObj.chatHistory as Array<{ role: string; text: string }> | undefined,
        geolocation: contextObj.geolocation as { city?: string; country?: string } | undefined,
      },
    });

    const suggestions = (result as { suggestions?: string[] })?.suggestions || [];
    console.log('[SuggestionWorkflow] Route handler returning:', {
      suggestionsCount: suggestions.length,
      suggestions: suggestions,
      resultKeys: Object.keys(result),
      resultSuggestions: (result as { suggestions?: string[] })?.suggestions?.length,
    });
    
    // Hono will automatically JSON.stringify plain objects
    // But let's return a Response to be explicit and ensure proper headers
    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error executing suggestion workflow:', error);
    throw error;
  }
}
