import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Escalation tool for handling cases where AI cannot answer
 * 
 * Used when:
 * - No relevant results found in knowledge base (no-match)
 * - Confidence is too low to provide reliable answer
 * - User explicitly requests human assistance
 * - Sensitive information or emergency detected
 */
export const escalateTool = createTool({
  id: 'escalate',
  description: 'Escalate conversation to human controller when AI cannot answer the question. Use this when no relevant information is found in the knowledge base, confidence is low, or the user requests human assistance.',
  inputSchema: z.object({
    reason: z.enum([
      'no_results',
      'low_confidence',
      'user_request',
      'sensitive',
      'emergency',
    ]).describe('Reason for escalation'),
    question: z.string().describe('The original question that triggered escalation'),
    chatId: z.string().optional().describe('Chat ID if available'),
    searchResultsCount: z.number().optional().default(0).describe('Number of search results found (0 for no-match)'),
  }),
  outputSchema: z.object({
    escalated: z.boolean(),
    message: z.string().describe('Message to show to the user'),
    requiresEmail: z.boolean().describe('Whether user email is required'),
    escalationId: z.string().optional().describe('Escalation record ID if created'),
  }),
  execute: async (input) => {
    const { reason, question, searchResultsCount = 0 } = input;
    const isNoMatch = reason === 'no_results' || searchResultsCount === 0;

    // Determine appropriate message based on reason
    let message: string;
    if (reason === 'emergency') {
      message = "For medical emergencies, please call 911 immediately. I've also notified our staff to follow up with you.";
    } else if (isNoMatch) {
      message = "I don't have information about that in our knowledge base. Let me connect you with someone who can help. Please provide your email address so we can get back to you.";
    } else if (reason === 'user_request') {
      message = "I'd be happy to connect you with a staff member. Please provide your email address so we can get back to you.";
    } else {
      message = "I want to make sure you get the most accurate information. Let me connect you with someone who can help. Please provide your email address so we can get back to you.";
    }

    // For MVP: Return message to collect email
    // In production: This would create escalation record in database via API call
    // For now, the AI Chatbot will handle creating the escalation record
    
    return {
      escalated: true,
      message,
      requiresEmail: true,
      escalationId: undefined, // Will be created by AI Chatbot when email is collected
    };
  },
});
