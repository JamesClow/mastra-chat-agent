import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { CloudExporter, DefaultExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import { parentSupportAgent } from './agents';
import { createChatRouteWithAutoSearch } from './routes/chat-with-auto-search';
import { handleSuggestionWorkflow } from './routes/suggestions';
import { completenessScorer, toolCallAppropriatenessScorer, translationScorer } from './scorers';
import { suggestionWorkflow } from './workflows';

export const mastra = new Mastra({
  workflows: { suggestionWorkflow },
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
      // Custom chat route with automatic vector search
      createChatRouteWithAutoSearch('parentSupportAgent'),
      // Custom route for suggestion workflow
      {
        path: '/workflows/suggestion-workflow',
        method: 'POST',
        handler: async (req: { body: unknown }) => {
          return await handleSuggestionWorkflow(req);
        },
      },
    ],
  },
});
