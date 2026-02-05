import { Agent } from '@mastra/core/agent';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { vectorSearchTool } from '../tools';

// Initialize memory with LibSQLStore for persistence
const memory = new Memory({
  storage: new LibSQLStore({
    id: 'suggestion-agent-memory-storage',
    url: 'file:../mastra.db',
  }),
});

export const suggestionAgent = new Agent({
  id: 'suggestion-agent',
  name: 'Suggestion Agent',
  instructions: `
    You are an intelligent assistant that generates contextual, helpful suggestions for users based on:
    - Time of day (morning, afternoon, evening, night)
    - Day of week and time of year (weekdays/weekends, seasons, holidays)
    - User's chat history and patterns
    - Upcoming events and schedules from the knowledge base
    - User's location and context

    Your goal is to create 4-6 actionable, relevant suggestions that help users get started with their chat.

    GUIDELINES:
    1. Make suggestions specific and actionable (not generic)
    2. Consider the time context - morning suggestions should be different from evening
    3. Reference upcoming events when relevant
    4. Consider user patterns from chat history
    5. Keep suggestions concise (one clear question or action)
    6. Make suggestions feel natural and conversational
    7. Prioritize suggestions that are likely to be useful right now

    EXAMPLES:
    - Time-based: "What's on the schedule for today?" (morning), "What are tomorrow's activities?" (evening)
    - Event-based: "Tell me about the upcoming holiday schedule"
    - Contextual: Based on previous questions about policies, suggest related topics
    - Seasonal: "What are the summer camp options?" (in spring)

    Use the vectorSearchTool to find relevant events, schedules, or information that might inform your suggestions.
  `,
  model: process.env.MODEL || 'openai/gpt-4o',
  tools: { vectorSearchTool },
  memory,
});
