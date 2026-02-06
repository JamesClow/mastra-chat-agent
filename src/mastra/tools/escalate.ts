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
    workflowRunId: z.string().optional().describe('ID of the email workflow run (if email required)'),
    suspended: z.boolean().optional().describe('Whether the workflow is suspended waiting for user input'),
    suspendPayload: z.object({
      message: z.string(),
      reason: z.string(),
    }).optional().describe('Payload from suspend() call (contains message for UI)'),
    escalated: z.boolean().describe('Whether escalation was initiated'),
    message: z.string().optional().describe('Message to show to the user (for emergency cases)'),
    requiresEmail: z.boolean().describe('Whether user email is required'),
    escalationId: z.string().optional().describe('Escalation record ID (created after email collected)'),
    reason: z.string().describe('Escalation reason (preserved from input)'),
    question: z.string().describe('Original question (preserved from input)'),
  }),
  execute: async (input) => {
    const { reason, question, chatId, searchResultsCount = 0 } = input;
    const isNoMatch = reason === 'no_results' || searchResultsCount === 0;

    // Determine if email is required (emergency doesn't need email)
    const requiresEmail = reason !== 'emergency';

    // For emergency cases, return message directly without workflow
    if (!requiresEmail) {
      return {
        escalated: true,
        message: "For medical emergencies, please call 911 immediately. I've also notified our staff to follow up with you.",
        requiresEmail: false,
        reason,
        question,
      };
    }

    // Determine appropriate message based on reason
    let escalationMessage: string;
    if (isNoMatch) {
      escalationMessage = "I don't have information about that in our knowledge base. Let me connect you with someone who can help. Please provide your email address so we can get back to you.";
    } else if (reason === 'user_request') {
      escalationMessage = "I'd be happy to connect you with a staff member. Please provide your email address so we can get back to you.";
    } else {
      escalationMessage = "I want to make sure you get the most accurate information. Let me connect you with someone who can help. Please provide your email address so we can get back to you.";
    }

    try {
      // Lazy import to avoid circular dependency
      const { mastra } = await import('../index');
      // Get the email workflow from Mastra
      const workflow = mastra.getWorkflow('requestEmailWorkflow');
      if (!workflow) {
        throw new Error('request-email-workflow not found');
      }

      // Generate a run ID upfront as fallback
      const generatedRunId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // Create a new workflow run (with or without explicit ID)
      const run = await workflow.createRun({ runId: generatedRunId });
      
      // Use the run's actual ID if available, otherwise use our generated one
      const workflowRunId: string = (run.id && typeof run.id === 'string' && run.id.trim() !== '') 
        ? run.id 
        : generatedRunId;
      
      if (!workflowRunId || typeof workflowRunId !== 'string' || workflowRunId.trim() === '') {
        throw new Error('Failed to get valid workflow run ID');
      }

      // Start the workflow with escalation message
      const result = await run.start({
        inputData: {
          message: escalationMessage,
          chatId,
        },
      });

      // Check if workflow is suspended
      if (result.status === 'suspended') {
        // Get the suspended step and its payload
        const suspendedStep = result.suspended?.[0];
        if (suspendedStep) {
          const stepData = result.steps[suspendedStep];
          const suspendPayload = stepData?.suspendPayload;

          return {
            workflowRunId: workflowRunId,
            suspended: true,
            suspendPayload: suspendPayload as { message: string; reason: string } | undefined,
            escalated: true,
            requiresEmail: true,
            reason,
            question,
          };
        }
      }

      // Workflow completed (shouldn't happen on first call, but handle it)
      if (result.status === 'success' && result.result) {
        return {
          workflowRunId: workflowRunId,
          suspended: false,
          escalated: true,
          requiresEmail: true,
          reason,
          question,
        };
      }

      // Fallback if something unexpected happens
      return {
        workflowRunId: workflowRunId,
        suspended: false,
        escalated: true,
        requiresEmail: true,
        reason,
        question,
      };
    } catch (error) {
      console.error('[EscalateTool] Error starting email workflow:', error);
      // Fallback: return message without workflow
      return {
        escalated: true,
        message: escalationMessage,
        requiresEmail: true,
        reason,
        question,
      };
    }
  },
});
