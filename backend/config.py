"""
Centralized model configuration.

Both the API (main.py) and the embedding uploader (embeddings_pinecone.py) import
from here so the query path and the index are always built with the same embedding
model and dimension, and the chat model lives in exactly one place.
"""

# --- Embeddings -------------------------------------------------------------
# text-embedding-3-large pinned to 1536 dimensions: higher retrieval quality than
# text-embedding-3-small, while keeping the existing Pinecone index dimension so no
# index recreation is needed. The `dimensions` parameter must be passed on every
# embeddings.create() call for both indexing and querying to stay consistent.
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSION = 1536

# --- Generation -------------------------------------------------------------
# GPT-5 generation chat model. Important API differences vs. the old gpt-4o-mini:
#   - use `max_completion_tokens` (the `max_tokens` parameter is rejected)
#   - `temperature` must be left at its default (any other value 400s), so it is omitted
#   - `reasoning_effort` controls latency vs. depth; "low" keeps recruiter replies snappy
# NOTE: on GPT-5 models max_completion_tokens covers reasoning tokens PLUS the visible
# answer, so this is set well above the visible-length we want to avoid truncated/empty
# replies; reasoning_effort="low" keeps the hidden reasoning small.
GENERATION_MODEL = "gpt-5.4-mini"
GENERATION_MAX_COMPLETION_TOKENS = 2048
GENERATION_REASONING_EFFORT = "low"
