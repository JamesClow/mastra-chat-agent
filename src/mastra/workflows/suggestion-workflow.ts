import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { suggestionAgent } from '../agents/suggestion-agent';

const contextSchema = z.object({
  userId: z.string(),
  userType: z.enum(['guest', 'regular']),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']),
  dayOfWeek: z.number().min(0).max(6),
  dayOfYear: z.number().min(1).max(366),
  isWeekend: z.boolean(),
  season: z.enum(['spring', 'summer', 'fall', 'winter']).optional(),
  isHoliday: z.boolean().optional(),
  holidayName: z.string().optional(),
  chatHistory: z.array(z.object({
    role: z.string(),
    text: z.string(),
  })).optional(),
  geolocation: z.object({
    city: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
});

export const generateSuggestions = createStep({
  id: 'generate-suggestions',
  description: 'Generates contextual suggestions using the suggestion agent',
  inputSchema: contextSchema,
  outputSchema: z.object({
    suggestions: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('Input data not found');
    }

    // Get current date/time information
    const now = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD format
    const currentDateReadable = `${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
    const dayOfWeekName = dayNames[inputData.dayOfWeek];
    const currentTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Format context as a structured message for the agent
    // The agent will use vectorSearchTool to find fresh information
    const contextParts: string[] = [
      `Current Date and Time:`,
      `- Today's date: ${currentDateReadable} (${currentDate})`,
      `- Day of week: ${dayOfWeekName}${inputData.isWeekend ? ' (Weekend)' : ' (Weekday)'}`,
      `- Time of day: ${inputData.timeOfDay} (Current time: ${currentTime})`,
      `- Season: ${inputData.season || 'not specified'}`,
      `- Day of year: ${inputData.dayOfYear}`,
    ];

    if (inputData.isHoliday && inputData.holidayName) {
      contextParts.push(`- Today is a holiday: ${inputData.holidayName}`);
    }

    contextParts.push(`\nUser Context:`);
    contextParts.push(`- User type: ${inputData.userType}`);

    if (inputData.geolocation?.city) {
      contextParts.push(`- Location: ${inputData.geolocation.city}${inputData.geolocation.country ? `, ${inputData.geolocation.country}` : ''}`);
    }

    if (inputData.chatHistory && inputData.chatHistory.length > 0) {
      const recentMessages = inputData.chatHistory.slice(-5);
      contextParts.push(`\nRecent Chat History:`);
      recentMessages.forEach(m => {
        contextParts.push(`- ${m.role}: ${m.text.substring(0, 150)}`);
      });
    }

    const userMessage = contextParts.join('\n');

    // Use the agent to generate suggestions
    // The agent will autonomously use vectorSearchTool based on its instructions
    const response = await suggestionAgent.generate([
      {
        role: 'user',
        content: userMessage,
      },
    ]);

    // Debug: Log the full response to see what the agent is returning
    console.log('[SuggestionWorkflow] Agent response:', {
      text: response.text,
      textLength: response.text?.length || 0,
      hasText: !!response.text,
      responseKeys: Object.keys(response),
    });

    // Parse the suggestions from the response
    const suggestionsText = response.text || '';
    console.log('[SuggestionWorkflow] Raw suggestions text:', suggestionsText.substring(0, 500));
    
    const suggestions = suggestionsText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^\d+[\.\)]/)) // Remove numbering
      .filter(s => s.length > 10 && s.length < 200) // Reasonable length
      .slice(0, 6); // Max 6 suggestions

    console.log('[SuggestionWorkflow] Parsed suggestions:', {
      count: suggestions.length,
      suggestions: suggestions,
    });

    // If we don't have enough suggestions, add some fallbacks
    if (suggestions.length < 4) {
      console.warn(`[SuggestionWorkflow] Only found ${suggestions.length} suggestions, adding fallbacks`);
      const fallbacks = [
        "What's on the school calendar this week?",
        "What are the school's attendance policies?",
        "How can I check my child's academic progress?",
        "Tell me about upcoming school events",
      ];
      suggestions.push(...fallbacks.slice(0, 4 - suggestions.length));
      console.log('[SuggestionWorkflow] Final suggestions with fallbacks:', suggestions);
    }

    return {
      suggestions: suggestions.slice(0, 6),
    };
  },
});

const suggestionWorkflow = createWorkflow({
  id: 'suggestion-workflow',
  inputSchema: contextSchema,
  outputSchema: z.object({
    suggestions: z.array(z.string()),
  }),
})
  .then(generateSuggestions);

suggestionWorkflow.commit();

export { suggestionWorkflow };
