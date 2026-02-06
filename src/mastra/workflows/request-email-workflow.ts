import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const requestEmailStep = createStep({
  id: 'request-email-step',
  inputSchema: z.object({
    message: z.string().optional().describe('Message to display above the email input'),
    chatId: z.string().optional().describe('Chat ID for context'),
  }),
  resumeSchema: z.object({
    email: z.string().email().describe('User\'s email input'),
  }),
  suspendSchema: z.object({
    message: z.string().describe('Message to display to the user'),
    reason: z.string().describe('Reason for requesting email'),
  }),
  outputSchema: z.object({
    email: z.string().describe('The collected email address'),
    submitted: z.boolean().describe('Confirmation that email was submitted'),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    const { message = 'Please provide your email address so we can get back to you.' } = inputData;
    const { email } = resumeData ?? {};

    // If no email provided, suspend and wait for user input
    if (!email) {
      return await suspend({
        message,
        reason: 'Email required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return await suspend({
        message: 'Please enter a valid email address.',
        reason: 'Invalid email format',
      });
    }

    // Return the validated email
    return {
      email: email.trim(),
      submitted: true,
    };
  },
});

const requestEmailWorkflow = createWorkflow({
  id: 'request-email-workflow',
  inputSchema: z.object({
    message: z.string().optional().describe('Message to display above the email input'),
    chatId: z.string().optional().describe('Chat ID for context'),
  }),
  outputSchema: z.object({
    email: z.string().describe('The collected email address'),
    submitted: z.boolean().describe('Confirmation that email was submitted'),
  }),
})
  .then(requestEmailStep);

requestEmailWorkflow.commit();

export { requestEmailWorkflow };
