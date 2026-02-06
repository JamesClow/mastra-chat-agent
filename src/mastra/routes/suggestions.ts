import { suggestionWorkflow } from '../workflows';

/**
 * Custom route handler for suggestion workflow
 * This can be called directly or via HTTP if MASTRA exposes workflows
 * POST /workflows/suggestion-workflow
 */
export async function handleSuggestionWorkflow(req: { body: unknown } | Request): Promise<{ suggestions: string[] }> {
  try {
    // Extract context from request body
    // Mastra might pass a Request object or a custom request object
    let bodyValue: unknown;
    
    // Check if it's a standard Request object
    if (req instanceof Request) {
      try {
        bodyValue = await req.json();
      } catch {
        // If JSON parsing fails, try text
        const text = await req.text();
        try {
          bodyValue = JSON.parse(text);
        } catch {
          throw new Error('Unable to parse request body as JSON');
        }
      }
    } else {
      // It's a custom request object
      const customReq = req as { body: unknown; [key: string]: unknown };
      bodyValue = customReq.body;
      
      // If body is a function, call it to get the actual value
      if (typeof bodyValue === 'function') {
        try {
          const result = bodyValue();
          // If the result is a promise, await it
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            bodyValue = await (result as Promise<unknown>);
          } else {
            bodyValue = result;
          }
        } catch (error) {
          console.error('[SuggestionWorkflow] Error calling body function:', error);
          // Try to get body from request directly if available
          if ('json' in customReq && typeof customReq.json === 'function') {
            try {
              bodyValue = await (customReq.json as () => Promise<unknown>)();
            } catch {
              throw new Error('Unable to extract request body');
            }
          } else {
            throw new Error('Unable to extract request body - body is a function that failed to execute');
          }
        }
      }
      
      // If body is a promise, await it
      if (bodyValue && typeof (bodyValue as Promise<unknown>).then === 'function') {
        bodyValue = await (bodyValue as Promise<unknown>);
      }
    }
    
    // The request body might be the context directly, or wrapped in a body property
    let context = bodyValue;
    
    // If body is an object with a 'body' property but doesn't have required fields, unwrap it
    if (context && typeof context === 'object' && 'body' in context && !('userId' in context)) {
      context = (context as { body: unknown }).body;
    }

    // Validate context structure
    if (!context || typeof context !== 'object') {
      console.error('[SuggestionWorkflow] Invalid context provided:', {
        context,
        type: typeof context,
        bodyValue,
        bodyType: typeof req.body,
        isFunction: typeof req.body === 'function',
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
        context: contextObj,
      });
      throw new Error(`Invalid context provided. Missing required fields: ${missingFields.join(', ')}. Provided fields: ${Object.keys(contextObj).join(', ')}`);
    }

    // Execute the workflow step directly since we can't easily access the full Mastra execution context
    // We'll call the step's execute method with the input data
    const workflowStep = (suggestionWorkflow as any).steps?.[0];
    if (!workflowStep) {
      throw new Error('Workflow step not found');
    }
    
    const result = await workflowStep.execute({
      inputData: context as {
        userId: string;
        userType: 'guest' | 'regular';
        timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
        dayOfWeek: number;
        dayOfYear: number;
        isWeekend: boolean;
        season?: 'spring' | 'summer' | 'fall' | 'winter';
        isHoliday?: boolean;
        holidayName?: string;
        chatHistory?: Array<{ role: string; text: string }>;
        upcomingEvents?: Array<{ title: string; date?: string; type: string; content: string }>;
        geolocation?: { city?: string; country?: string };
      },
    });

    // Return suggestions
    return { suggestions: result?.suggestions || [] };
  } catch (error) {
    console.error('Error executing suggestion workflow:', error);
    // Re-throw with more context if it's a validation error
    if (error instanceof Error && (error.message.includes('Invalid context') || error.message.includes('Missing required'))) {
      // Try to stringify the request, but handle if body is a function
      let bodyStr = 'Unable to stringify request body';
      try {
        if (req instanceof Request) {
          bodyStr = 'Request object (body already parsed)';
        } else {
          const bodyToStr = (req as { body: unknown }).body;
          if (typeof bodyToStr === 'function') {
            bodyStr = 'Request body is a function';
          } else {
            bodyStr = JSON.stringify(bodyToStr, null, 2);
          }
        }
      } catch {
        bodyStr = 'Error stringifying request body';
      }
      throw new Error(`${error.message}. Request info: ${bodyStr}`);
    }
    throw error;
  }
}
