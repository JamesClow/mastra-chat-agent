import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const multipleChoiceStep = createStep({
  id: 'multiple-choice-step',
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
  resumeSchema: z.object({
    selectedOptionId: z.string().describe('ID of the option selected by the user'),
  }),
  suspendSchema: z.object({
    question: z.string().describe('The question text to display'),
    options: z.array(
      z.object({
        id: z.string().describe('Unique identifier for the option'),
        label: z.string().describe('Display label for the option'),
      })
    ).describe('Array of choice options'),
    reason: z.string().describe('Reason for requesting selection'),
  }),
  outputSchema: z.object({
    selectedOptionId: z.string().describe('ID of the selected option'),
    selectedOptionLabel: z.string().describe('Label of the selected option'),
    submitted: z.boolean().describe('Confirmation that selection was submitted'),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    const { question, options } = inputData;
    const { selectedOptionId } = resumeData ?? {};

    // If no selection provided, suspend and wait for user input
    if (!selectedOptionId) {
      return await suspend({
        question,
        options,
        reason: 'User selection required',
      });
    }

    // Validate that the selected option ID exists
    const selectedOption = options.find((opt) => opt.id === selectedOptionId);
    if (!selectedOption) {
      return await suspend({
        question,
        options,
        reason: 'Invalid option selected',
      });
    }

    // Return the selected option
    return {
      selectedOptionId: selectedOption.id,
      selectedOptionLabel: selectedOption.label,
      submitted: true,
    };
  },
});

const multipleChoiceWorkflow = createWorkflow({
  id: 'multiple-choice-workflow',
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
    selectedOptionId: z.string().describe('ID of the selected option'),
    selectedOptionLabel: z.string().describe('Label of the selected option'),
    submitted: z.boolean().describe('Confirmation that selection was submitted'),
  }),
})
  .then(multipleChoiceStep);

multipleChoiceWorkflow.commit();

export { multipleChoiceWorkflow };
