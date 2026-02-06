import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Email input tool that triggers the email input workflow
 * 
 * This tool starts a workflow that suspends to collect email from the user
 * via a custom UI component.
 */
export const requestEmailTool = createTool({
  id: 'request-email',
  description: 'Request the user\'s email address. This will display an email input field for the user to enter their email.',
  inputSchema: z.object({
    message: z.string().optional().describe('Message to display above the email input'),
    chatId: z.string().optional().describe('Chat ID for context'),
  }),
  outputSchema: z.object({
    workflowRunId: z.string().describe('ID of the workflow run'),
    suspended: z.boolean().describe('Whether the workflow is suspended waiting for user input'),
    suspendPayload: z.object({
      message: z.string(),
      reason: z.string(),
    }).optional().describe('Payload from suspend() call (for UI rendering)'),
    email: z.string().optional().describe('The collected email address (if workflow completed)'),
    submitted: z.boolean().optional().describe('Confirmation that email was submitted (if workflow completed)'),
  }),
  execute: async (input, context) => {
    const { message, chatId } = input;

    try {
      // Lazy import to avoid circular dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { mastra } = await import('../index');
      // Get the email workflow from Mastra (use workflow key, not ID)
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

      // Start the workflow with input data
      const result = await run.start({
        inputData: {
          message,
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
          };
        }
      }

      // Workflow completed - extract result
      if (result.status === 'success' && result.result) {
        return {
          workflowRunId: workflowRunId,
          suspended: false,
          email: result.result.email,
          submitted: result.result.submitted,
        };
      }

      // Unexpected status
      return {
        workflowRunId: workflowRunId,
        suspended: false,
      };
    } catch (error) {
      console.error('[RequestEmailTool] Error:', error);
      throw error;
    }
  },
});
