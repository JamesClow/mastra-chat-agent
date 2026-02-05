# Pinecone Setup for Mastra Chat Agent

This guide will help you integrate Pinecone vector database into your Mastra chat agent for RAG (Retrieval-Augmented Generation) functionality.

## Prerequisites

✅ Pinecone SDK is already installed: `@pinecone-database/pinecone`

## Step 1: Get Your Pinecone API Key

1. Go to [https://app.pinecone.io/](https://app.pinecone.io/)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Copy your API key

## Step 2: Configure Environment Variables

Add to your `.env` file (or `.env.local`):

```bash
# Required: Your Pinecone API key
PINECONE_API_KEY=your-api-key-here

# Optional: Default index name (defaults to "default-index" if not set)
PINECONE_INDEX=chatbot-knowledge-base
```

**⚠️ Important:** Never commit `.env` to git. It should already be in `.gitignore`.

## Step 3: Create Your First Index

You have four options to create an index:

### Option 1: Using Pinecone CLI (Recommended for Quick Setup)

```bash
# Create index with integrated embeddings
pc index create \
  -n chatbot-knowledge-base \
  -m cosine \
  -c aws \
  -r us-east-1 \
  --model llama-text-embed-v2 \
  --field_map text=content
```

**Parameters explained:**
- `-n chatbot-knowledge-base`: Index name
- `-m cosine`: Similarity metric (cosine is recommended for text)
- `-c aws`: Cloud provider (aws, gcp, azure)
- `-r us-east-1`: Region
- `--model llama-text-embed-v2`: Embedding model (recommended)
- `--field_map text=content`: Maps the text field to "content" in your records

### Option 2: Using Web Console

1. Go to [https://app.pinecone.io/](https://app.pinecone.io/)
2. Click **Create Index**
3. Configure:
   - **Name**: `chatbot-knowledge-base`
   - **Metric**: `cosine`
   - **Cloud**: `AWS` (or your preference)
   - **Region**: `us-east-1` (or closest to you)
   - **Embedding Model**: `llama-text-embed-v2`
   - **Field Map**: `text=content`

### Option 3: Auto-create in Application Code

See `src/pinecone/setup.ts` (create this file if needed) for programmatic index creation.

### Option 4: Dedicated Setup Script

Create a setup script that runs once to initialize your index.

## Step 4: Verify Index Creation

```bash
# List all indexes
pc index list

# Describe your index
pc index describe --name chatbot-knowledge-base
```

## Step 5: Add Data to Your Index

Create a script to upsert sample data:

```typescript
// scripts/seed-pinecone.ts
import { getPineconeIndex } from '../src/pinecone/client';

const index = getPineconeIndex('chatbot-knowledge-base');

const sampleDocuments = [
  {
    _id: 'doc1',
    content: 'Our daycare center operates from 7 AM to 6 PM, Monday through Friday.',
    category: 'hours',
    type: 'policy',
  },
  {
    _id: 'doc2',
    content: 'Children must be picked up by 6 PM. Late fees apply after 6:15 PM.',
    category: 'pickup',
    type: 'policy',
  },
  // Add more documents...
];

async function seedData() {
  // Upsert records into the "public" namespace
  await index.namespace('public').upsertRecords(sampleDocuments);
  
  // Wait for indexing (records become searchable in 5-10 seconds)
  console.log('Waiting for records to be indexed...');
  await new Promise((resolve) => setTimeout(resolve, 10000));
  
  console.log('✅ Data seeded successfully!');
}

seedData().catch(console.error);
```

Run it:
```bash
npx tsx scripts/seed-pinecone.ts
```

## Step 6: Vector Search Tool Integration

The `vectorSearchTool` is already integrated into your Mastra agent! It's available in:

- **File**: `src/mastra/tools/vector-search.ts`
- **Agent**: `src/mastra/agents/index.ts` (already added to `weatherAgent`)

The agent will automatically use the vector search tool when users ask questions that require knowledge base lookups.

## Step 7: Multi-Tenant Setup (For Your Use Case)

Based on your requirements, you'll need:

1. **Public namespace** - For end-user AI (common policies, schedules, FAQs)
2. **Restricted namespace** - For admin/controller AI (restricted documents)

The `vectorSearchTool` accepts a `namespace` parameter, so you can:

```typescript
// In your agent or workflow, you can specify the namespace based on user type
const namespace = userType === 'admin' ? 'restricted' : 'public';
```

Or create separate agents with different default namespaces.

## Best Practices

1. **Always use namespaces** - Required for data isolation
2. **Wait after upserting** - Records become searchable in 5-10 seconds
3. **Use reranking** - Already included in `vectorSearchTool` for best results
4. **Handle errors gracefully** - The tool includes error handling
5. **Respect batch limits** - Max 96 text records per batch

## Testing the Integration

1. Start your Mastra server:
   ```bash
   npm run dev
   ```

2. Send a test message that should trigger vector search:
   ```
   "What are your operating hours?"
   ```

3. The agent should automatically use `vectorSearchTool` to find relevant information.

## Troubleshooting

### "PINECONE_API_KEY required" error
- Check that `.env` has `PINECONE_API_KEY` set
- Restart your Mastra dev server after adding the env var

### "Index not found" error
- Verify index name matches what you created
- Check with `pc index list`

### Search returns no results
- Wait 10+ seconds after upserting data
- Verify namespace matches what you used for upserting
- Check that data was actually upserted

### Tool not being called
- Check agent instructions mention the vector search tool
- Verify the tool is in the agent's `tools` object
- Check Mastra logs for tool call errors

## Next Steps

1. ✅ Set up your API key
2. ✅ Create your index
3. ✅ Seed some sample data
4. ✅ Test the vector search tool
5. 📚 Read the full guides in `.agents/` directory (in parent project) for advanced features

## Resources

- **Pinecone Docs**: [https://docs.pinecone.io/](https://docs.pinecone.io/)
- **TypeScript Guide**: `../.agents/PINECONE-typescript.md`
- **Quickstart Guide**: `../.agents/PINECONE-quickstart.md`
- **Troubleshooting**: `../.agents/PINECONE-troubleshooting.md`
