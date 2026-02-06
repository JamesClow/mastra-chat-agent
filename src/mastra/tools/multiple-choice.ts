import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Multiple choice tool that triggers the multiple choice workflow
 * 
 * This tool starts a workflow that suspends to collect user selection from
 * multiple choice options via a custom UI component.
 */
export const multipleChoiceTool = createTool({
  id: 'multiple-choice',
  description: 'Present a multiple choice question to the user to clarify their needs or narrow down options. This tool displays an interactive question with selectable options, making it easier to understand what the user is looking for. Use this proactively when questions are ambiguous or when you need to categorize the user\'s request before searching the knowledge base. This is often more effective than immediately escalating.',
  inputSchema: z.object({
    question: z.string().describe('The question text to display'),
    options: z.array(
      z.object({
        id: z.string().describe('Unique identifier for the option'),
        label: z.string().describe('Display label for the option'),
      })
    ).min(2).describe('Array of choice options (minimum 2)'),
    chatId: z.string().optional().describe('Chat ID for context'),
  }),
  outputSchema: z.object({
    workflowRunId: z.string().describe('ID of the workflow run'),
    suspended: z.boolean().describe('Whether the workflow is suspended waiting for user input'),
    suspendPayload: z.object({
      question: z.string(),
      options: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
        })
      ),
      reason: z.string(),
    }).optional().describe('Payload from suspend() call (for UI rendering)'),
    selectedOptionId: z.string().optional().describe('ID of the selected option (if workflow completed)'),
    selectedOptionLabel: z.string().optional().describe('Label of the selected option (if workflow completed)'),
    submitted: z.boolean().optional().describe('Confirmation that selection was submitted (if workflow completed)'),
  }),
  execute: async (input, context) => {
    const { question, options, chatId } = input;

    try {
      // Lazy import to avoid circular dependency
      const { mastra } = await import('../index');
      // Get the multiple choice workflow from Mastra
      const workflow = mastra.getWorkflow('multipleChoiceWorkflow');
      if (!workflow) {
        throw new Error('multiple-choice-workflow not found');
      }

      // Generate a run ID upfront as fallback
      const generatedRunId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // Create a new workflow run (with or without explicit ID)
      const run = await workflow.createRun({ runId: generatedRunId });
      
      // Use the run's actual ID if available, otherwise use our generated one
      // This ensures we always have a valid ID that matches what Mastra expects
      const workflowRunId: string = (run.id && typeof run.id === 'string' && run.id.trim() !== '') 
        ? run.id 
        : generatedRunId;
      
      if (!workflowRunId || typeof workflowRunId !== 'string' || workflowRunId.trim() === '') {
        throw new Error('Failed to get valid workflow run ID');
      }
      
      // Start the workflow with input data
      const result = await run.start({
        inputData: {
          question,
          options,
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

          // Ensure we have a valid workflowRunId - use fallback if needed
          const finalRunId = workflowRunId || generatedRunId;
          if (!finalRunId || typeof finalRunId !== 'string') {
            throw new Error(`Invalid workflowRunId: ${workflowRunId}, fallback: ${generatedRunId}`);
          }

          // Build output object - ensure workflowRunId is always first and explicitly set
          const returnValue: {
            workflowRunId: string;
            suspended: boolean;
            suspendPayload?: {
              question: string;
              options: Array<{ id: string; label: string }>;
              reason: string;
            };
          } = {
            workflowRunId: finalRunId,
            suspended: true,
            ...(suspendPayload && {
              suspendPayload: {
                question: suspendPayload.question || question,
                options: suspendPayload.options || options,
                reason: suspendPayload.reason || 'User selection required',
              },
            }),
          };
          
          return returnValue;
        } else {
          // Suspended but no suspended step found - return with workflowRunId anyway
          const finalRunId = workflowRunId || generatedRunId;
          if (!finalRunId || typeof finalRunId !== 'string') {
            throw new Error(`Invalid workflowRunId in fallback: ${workflowRunId}, fallback: ${generatedRunId}`);
          }
          
          return {
            workflowRunId: finalRunId,
            suspended: true,
          };
        }
      }

      // Workflow completed - extract result
      if (result.status === 'success' && result.result) {
        const finalRunId = workflowRunId || generatedRunId;
        if (!finalRunId || typeof finalRunId !== 'string') {
          throw new Error(`Invalid workflowRunId on completion: ${workflowRunId}, fallback: ${generatedRunId}`);
        }
        
        return {
          workflowRunId: finalRunId,
          suspended: false,
          selectedOptionId: result.result.selectedOptionId,
          selectedOptionLabel: result.result.selectedOptionLabel,
          submitted: result.result.submitted,
        };
      }

      // Unexpected status
      const finalRunId = workflowRunId || generatedRunId;
      if (!finalRunId || typeof finalRunId !== 'string') {
        throw new Error(`Invalid workflowRunId for unexpected status: ${workflowRunId}, fallback: ${generatedRunId}`);
      }
      
      return {
        workflowRunId: finalRunId,
        suspended: false,
      };
    } catch (error) {
      console.error('[MultipleChoiceTool] Error:', error);
      throw error;
    }
  },
});
