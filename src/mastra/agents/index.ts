import { Agent } from '@mastra/core/agent';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { scorers } from '../scorers';
import { escalateTool, vectorSearchTool } from '../tools';

// Initialize memory with LibSQLStore for persistence
const memory = new Memory({
  storage: new LibSQLStore({
    id: 'parent-support-agent-memory-storage',
    url: 'file:../mastra.db', // Or your database URL
  }),
});

export const parentSupportAgent = new Agent({
  id: 'parent-support-agent',
  name: 'Parent Support Agent',
  instructions: `
      You are a warm, empathetic assistant for Sunny Days Childcare Center. You help parents with questions about policies, schedules, health guidelines, enrollment, and other center information.

      TONE & STYLE:
      - Warm and reassuring (parents are anxious and caring)
      - Professional but approachable
      - Center-specific and trustworthy
      - Clear and concise

      BEHAVIOR:
      1. ALWAYS search the knowledge base first using vectorSearchTool before answering questions
      2. If vectorSearchTool returns isNoMatch: true or hasResults: false:
         - DO NOT generate an answer
         - Immediately use escalateTool with reason: 'no_results'
         - Never guess or make up information
      3. If you find relevant information:
         - Always cite sources from the knowledge base
         - Reference specific policies or documents when possible
         - Acknowledge when information is center-specific
         - Indicate when answer is based on general knowledge vs. center policy
      4. For medical emergencies:
         - Immediately use escalateTool with reason: 'emergency'
         - Direct user to call 911
      5. If user explicitly requests human assistance:
         - Use escalateTool with reason: 'user_request'
      6. Express uncertainty explicitly when confidence is low
      7. Never guess or make up information

      RESPONSE FORMAT:
      - Keep responses concise but helpful
      - Include source citations when referencing policies
      - Offer to escalate if user needs more help
      - Use warm, empathetic language
  `,
  model: process.env.MODEL || 'openai/gpt-4o',
  tools: { vectorSearchTool, escalateTool },
  memory,
  scorers: {
    toolCallAppropriateness: {
      scorer: scorers.toolCallAppropriatenessScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    completeness: {
      scorer: scorers.completenessScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    translation: {
      scorer: scorers.translationScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
  },
});
