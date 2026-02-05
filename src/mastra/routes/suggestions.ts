import { suggestionWorkflow } from '../workflows';

/**
 * Custom route handler for suggestion workflow
 * This can be called directly or via HTTP if MASTRA exposes workflows
 * POST /workflows/suggestion-workflow
 */
export async function handleSuggestionWorkflow(context: unknown) {
  try {
    // Validate context
    if (!context || typeof context !== 'object') {
      throw new Error('Invalid context provided');
    }

    // Execute the workflow directly
    const result = await suggestionWorkflow.execute(context);

    // Return suggestions
    return { suggestions: result.suggestions || [] };
  } catch (error) {
    console.error('Error executing suggestion workflow:', error);
    throw error;
  }
}
