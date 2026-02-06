import { z } from 'zod';

const resumeRequestSchema = z.object({
  workflowRunId: z.string().describe('ID of the workflow run to resume'),
  step: z.string().describe('Step ID to resume'),
  resumeData: z.record(z.unknown()).describe('Data matching step\'s resumeSchema'),
  escalationContext: z.object({
    reason: z.string(),
    question: z.string(),
    chatId: z.string(),
    searchResultsCount: z.number().optional().default(0),
  }).optional().describe('Context for escalation record creation'),
});

/**
 * Extract the JSON body from whatever request object Mastra/Hono passes us.
 * 
 * Mastra uses Hono under the hood, so the `req` parameter is actually a Hono Context (c).
 * - c.req.json() → parsed JSON body (this is what we need)
 * - c.body → method to CREATE a Response (NOT the request body!)
 * - c.req.raw → the raw Fetch Request
 */
async function extractRequestBody(req: unknown): Promise<unknown> {
  const r = req as Record<string, unknown>;

  // 1. Hono Context: req.req.json() — this is the most likely case in Mastra
  if (r.req && typeof r.req === 'object') {
    const honoReq = r.req as Record<string, unknown>;
    if (typeof honoReq.json === 'function') {
      try {
        return await (honoReq.json as () => Promise<unknown>)();
      } catch (error) {
        console.warn('[WorkflowResume] Failed to parse via req.req.json():', error);
      }
    }
    // Also try req.req.raw (the raw Fetch Request)
    if (honoReq.raw && honoReq.raw instanceof Request) {
      try {
        return await honoReq.raw.json();
      } catch (error) {
        console.warn('[WorkflowResume] Failed to parse via req.req.raw.json():', error);
      }
    }
  }

  // 2. Standard Fetch Request: req.json()
  if (req instanceof Request) {
    try {
      return await req.json();
    } catch {
      const text = await req.text();
      return JSON.parse(text);
    }
  }

  // 3. Plain object with already-parsed body (e.g. { body: { ... } })
  if (r.body && typeof r.body === 'object' && typeof r.body !== 'function') {
    return r.body;
  }

  // 4. req.json() method (some frameworks expose this)
  if (typeof r.json === 'function' && !('req' in r)) {
    try {
      return await (r.json as () => Promise<unknown>)();
    } catch (error) {
      console.warn('[WorkflowResume] Failed to parse via req.json():', error);
    }
  }

  throw new Error('Unable to extract request body from the provided request object');
}

/**
 * Route handler for resuming workflows
 * POST /workflows/resume
 */
export async function handleWorkflowResume(req: unknown): Promise<Response> {
  try {
    // Parse and validate request body using the same pattern as other handlers
    const bodyValue = await extractRequestBody(req);
    
    // The request body might be the context directly, or wrapped in a body property
    let body = bodyValue;
    
    // If body is an object with a 'body' property but doesn't have required fields, unwrap it
    if (body && typeof body === 'object' && 'body' in (body as Record<string, unknown>) && !('workflowRunId' in (body as Record<string, unknown>))) {
      body = (body as { body: unknown }).body;
    }
    
    // Validate body structure
    if (!body || typeof body !== 'object') {
      console.error('[WorkflowResume] Invalid body after parsing:', {
        body,
        type: typeof body,
      });
      throw new Error('Invalid request body. Expected an object with workflowRunId, step, and resumeData.');
    }
    
    const parsed = resumeRequestSchema.parse(body);

    const { workflowRunId, step, resumeData, escalationContext } = parsed;

    // Lazy import to avoid circular dependency
    const { mastra } = await import('../index');

    // Determine which workflow to resume based on the step ID
    // Use workflow keys (camelCase) that match the Mastra config, not workflow IDs
    let workflow;
    if (step === 'request-email-step') {
      workflow = mastra.getWorkflow('requestEmailWorkflow');
    } else if (step === 'multiple-choice-step') {
      workflow = mastra.getWorkflow('multipleChoiceWorkflow');
    } else {
      // Try both workflows - start with email workflow
      workflow = mastra.getWorkflow('requestEmailWorkflow');
    }

    if (!workflow) {
      throw new Error(`Workflow not found for step: ${step}`);
    }

    const run = await workflow.createRun({ runId: workflowRunId });

    // Resume the workflow
    const result = await run.resume({
      step,
      resumeData,
    });

    // If workflow completed and escalation context provided, create escalation record
    let escalationId: string | undefined;
    if (result.status === 'success' && escalationContext) {
      // The escalation record will be created in the frontend API proxy
      // We'll include the email in the response so the frontend can create the record
      // Use 'result' property for successful workflows, not 'output'
      const email = (result.result as { email?: string })?.email;
      if (email) {
        // Return the email so frontend can create escalation record
        return new Response(
          JSON.stringify({
            status: result.status,
            output: result.result,
            escalationContext: {
              ...escalationContext,
              email,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Return the result
    // Use 'result' property for successful workflows, check status for suspended
    return new Response(
      JSON.stringify({
        status: result.status,
        output: result.status === 'success' ? result.result : undefined,
        suspended: result.status === 'suspended',
        suspendedSteps: result.status === 'suspended' ? result.suspended : undefined,
        escalationId,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[WorkflowResume] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
