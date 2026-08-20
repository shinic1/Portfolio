# NicoBot Cloudflare API

Cloudflare Worker replacement for the portfolio's Render and Pinecone RAG
backend. It preserves the existing `/chat` and `/chat/stream` response contract
while using a Cloudflare Vectorize binding for retrieval.

## Setup

```bash
npm install
npx wrangler vectorize create nicobot-portfolio --dimensions=1536 --metric=cosine
OPENAI_API_KEY=sk-... npm run index
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

The index is configured for `text-embedding-3-large` at 1,536 dimensions with
cosine similarity. `scripts/index-documents.mjs` reads the existing
`backend/portfolio_docs.json`, creates embeddings in one batch, and upserts the
vectors without writing credentials or generated vectors into the repository.
The indexer accepts `OPENAI_API_KEY` from the environment or the legacy
`backend/.env` file.

## Verify

```bash
npm run validate
curl https://nicobot-api.arts-access-miami.workers.dev/
```

The legacy FastAPI service remains in the repository as a rollback target.
