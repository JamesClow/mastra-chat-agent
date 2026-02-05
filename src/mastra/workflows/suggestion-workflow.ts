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

    // Time-based insights (parent-focused)
    if (inputData.timeOfDay === 'morning') {
      insights.push('Parent is likely starting their day - suggest questions about today\'s schedule, drop-off, attendance');
    } else if (inputData.timeOfDay === 'afternoon') {
      insights.push('Parent may be asking about pick-up, after-school activities, or homework');
    } else if (inputData.timeOfDay === 'evening' || inputData.timeOfDay === 'night') {
      insights.push('Parent is likely planning for tomorrow or asking about upcoming events');
    }

    // Day-based insights
    if (inputData.isWeekend) {
      insights.push('Weekend context - parent may be planning for next week, asking about schedules or events');
    } else {
      insights.push('Weekday context - parent may need quick answers about today\'s schedule, attendance, or immediate needs');
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

    prompt += `\nIMPORTANT CONTEXT:
- The user is a PARENT of a K-12 student
- They are asking questions about their child/student or school policies
- Focus suggestions on: student information, school policies, schedules, events, academic info

Requirements:
- Generate exactly 4-6 suggestions
- Each suggestion should be a complete, actionable question a parent would ask
- Focus on: student info, school policies, schedules, events, academic topics
- Make them specific to the context (time, events, user patterns)
- Keep each suggestion concise (one sentence, parent-friendly language)
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
        "What's on the school calendar this week?",
        "What are the school's attendance policies?",
        "How can I check my child's academic progress?",
        "Tell me about upcoming school events",
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
