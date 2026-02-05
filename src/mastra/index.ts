import { chatRoute } from '@mastra/ai-sdk';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { CloudExporter, DefaultExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import { parentSupportAgent } from './agents';
import { handleSuggestionWorkflow } from './routes/suggestions';
import { completenessScorer, toolCallAppropriatenessScorer, translationScorer } from './scorers';
import { suggestionWorkflow, weatherWorkflow } from './workflows';

export const mastra = new Mastra({
  workflows: { weatherWorkflow, suggestionWorkflow },
  agents: { parentSupportAgent },
  storage: new LibSQLStore({ id: 'parent-support-agent-storage', url: ':memory:' }),
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(), // Persists traces to storage for Mastra Studio
          new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
  server: {
    apiRoutes: [
      chatRoute({
        path: '/chat',
        agent: 'parentSupportAgent',
      }),
      // Custom route for suggestion workflow
      {
        path: '/workflows/suggestion-workflow',
        method: 'POST',
        handler: async (req: { body: unknown }) => {
          return await handleSuggestionWorkflow(req.body);
        },
      },
    ],
  },
});
