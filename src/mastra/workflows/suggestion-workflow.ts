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
  upcomingEvents: z.array(z.object({
    title: z.string(),
    date: z.string().optional(),
    type: z.string(),
    content: z.string(),
  })).optional(),
  geolocation: z.object({
    city: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
});

const generateSuggestions = createStep({
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

    const insights: string[] = [];

    // Time-based insights
    if (inputData.timeOfDay === 'morning') {
      insights.push('User is likely starting their day - suggest proactive questions');
    } else if (inputData.timeOfDay === 'evening' || inputData.timeOfDay === 'night') {
      insights.push('User is likely planning for tomorrow or wrapping up their day');
    }

    // Day-based insights
    if (inputData.isWeekend) {
      insights.push('Weekend context - may be less urgent, more planning-focused');
    } else {
      insights.push('Weekday context - may need quick answers for immediate needs');
    }

    // Seasonal insights
    if (inputData.season) {
      insights.push(`Seasonal context: ${inputData.season}`);
    }

    // Holiday insights
    if (inputData.isHoliday && inputData.holidayName) {
      insights.push(`Holiday context: ${inputData.holidayName}`);
    }

    // Event insights
    if (inputData.upcomingEvents && inputData.upcomingEvents.length > 0) {
      insights.push(`Found ${inputData.upcomingEvents.length} upcoming events in knowledge base`);
    }

    // Chat history insights
    if (inputData.chatHistory && inputData.chatHistory.length > 0) {
      const userMessages = inputData.chatHistory.filter(m => m.role === 'user');
      if (userMessages.length > 0) {
        insights.push(`User has ${userMessages.length} previous messages - can infer interests`);
      }
    }

    const contextSummary = `
Context Analysis:
- Time: ${inputData.timeOfDay} on ${inputData.isWeekend ? 'weekend' : 'weekday'}
- Day of year: ${inputData.dayOfYear}${inputData.season ? ` (${inputData.season})` : ''}
${inputData.isHoliday && inputData.holidayName ? `- Holiday: ${inputData.holidayName}` : ''}
${inputData.upcomingEvents && inputData.upcomingEvents.length > 0 ? `- Upcoming events: ${inputData.upcomingEvents.length} found` : ''}
${inputData.chatHistory && inputData.chatHistory.length > 0 ? `- Chat history: ${inputData.chatHistory.length} messages` : ''}
${inputData.geolocation?.city ? `- Location: ${inputData.geolocation.city}` : ''}
    `.trim();

    // Build a comprehensive prompt for the agent
    let prompt = `Generate 4-6 contextual suggestions for a user based on the following context:\n\n${contextSummary}\n\nKey Insights:\n${insights.map(i => `- ${i}`).join('\n')}\n\n`;

    // Add upcoming events if available
    if (inputData.upcomingEvents && inputData.upcomingEvents.length > 0) {
      prompt += `\nUpcoming Events:\n${inputData.upcomingEvents.slice(0, 5).map(e => `- ${e.title}${e.date ? ` (${e.date})` : ''}`).join('\n')}\n\n`;
    }

    // Add recent chat history context if available
    if (inputData.chatHistory && inputData.chatHistory.length > 0) {
      const recentMessages = inputData.chatHistory.slice(-5);
      prompt += `\nRecent Chat History (for context):\n${recentMessages.map(m => `${m.role}: ${m.text.substring(0, 100)}`).join('\n')}\n\n`;
    }

    prompt += `\nRequirements:
- Generate exactly 4-6 suggestions
- Each suggestion should be a complete, actionable question or statement
- Make them specific to the context (time, events, user patterns)
- Keep each suggestion concise (one sentence)
- Return ONLY the suggestions, one per line, no numbering or bullets
- Format: Just the text of each suggestion, separated by newlines`;

    // Use the agent to generate suggestions
    const response = await suggestionAgent.generate([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    // Parse the suggestions from the response
    const suggestionsText = response.text || '';
    const suggestions = suggestionsText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^\d+[\.\)]/)) // Remove numbering
      .filter(s => s.length > 10 && s.length < 200) // Reasonable length
      .slice(0, 6); // Max 6 suggestions

    // If we don't have enough suggestions, add some fallbacks
    if (suggestions.length < 4) {
      const fallbacks = [
        "What can I help you with today?",
        "Tell me about upcoming events",
        "What are the center's policies?",
        "How can I get more information?",
      ];
      suggestions.push(...fallbacks.slice(0, 4 - suggestions.length));
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
