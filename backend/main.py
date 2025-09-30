"""
FastAPI backend for NicoBot portfolio chatbot.
Provides /chat endpoint for RAG-based question answering using Pinecone.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from openai import OpenAI
from pinecone import Pinecone
from dotenv import load_dotenv

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env"))

# Initialize FastAPI app
app = FastAPI(title="NicoBot API")

# Configure CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize clients
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

# Pinecone index
INDEX_NAME = "nicobot-portfolio"
pinecone_index = None

class ChatRequest(BaseModel):
    question: str

class EmbeddingStats(BaseModel):
    dimension: int
    norm: float
    active_dimensions: int

class RetrievalMatch(BaseModel):
    score: float
    doc_id: str

class GenerationStats(BaseModel):
    tokens: int
    time_ms: int

class ChatMetadata(BaseModel):
    embedding_stats: EmbeddingStats
    retrieval_stats: list[RetrievalMatch]
    generation_stats: GenerationStats

class ChatResponse(BaseModel):
    reply: str
    metadata: ChatMetadata

@app.on_event("startup")
async def load_index():
    """Connect to Pinecone index on startup."""
    global pinecone_index

    try:
        print(f"Connecting to Pinecone index: {INDEX_NAME}")
        pinecone_index = pc.Index(INDEX_NAME)

        # Verify connection
        stats = pinecone_index.describe_index_stats()
        print(f"✓ Successfully connected to Pinecone")
        print(f"  - Total vectors: {stats.total_vector_count}")
    except Exception as e:
        print(f"ERROR: Could not connect to Pinecone. Please run embeddings_pinecone.py first.")
        print(f"Error: {e}")
        raise

def embed_query(query: str) -> tuple[list[float], EmbeddingStats]:
    """Generate embedding for a query using OpenAI and return stats."""
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=[query]
    )
    embedding = response.data[0].embedding

    # Calculate stats
    import math
    norm = math.sqrt(sum(x * x for x in embedding))
    active_dims = sum(1 for x in embedding if abs(x) > 0.01)  # Count significant dimensions

    stats = EmbeddingStats(
        dimension=len(embedding),
        norm=round(norm, 4),
        active_dimensions=active_dims
    )

    return embedding, stats

def retrieve_relevant_docs(query_embedding: list[float], k: int = 3) -> tuple[list[str], list[RetrievalMatch]]:
    """Retrieve top k relevant documents from Pinecone and return stats."""
    # Query Pinecone
    results = pinecone_index.query(
        vector=query_embedding,
        top_k=k,
        include_metadata=True
    )

    # Extract content and match stats from results
    relevant_docs = []
    retrieval_matches = []
    for i, match in enumerate(results.matches):
        if match.metadata and "content" in match.metadata:
            relevant_docs.append(match.metadata["content"])
            retrieval_matches.append(RetrievalMatch(
                score=round(match.score, 4),
                doc_id=f"doc_{i}"
            ))

    return relevant_docs, retrieval_matches

def generate_response(query: str, context_docs: list[str]) -> tuple[str, GenerationStats]:
    """Generate response using GPT-4o-mini with retrieved context and return stats."""
    import time
    start_time = time.time()

    context = "\n\n".join(context_docs)

    system_prompt = """You are Nico Bourel's portfolio assistant. Your role is to help visitors learn about Nico's background, skills, projects, and experience.

Use ONLY the provided context to answer questions. If the answer is not in the context, respond with "I don't know" or "I don't have information about that in my knowledge base."

Be friendly, concise, and helpful. When discussing projects, highlight the technologies and skills involved."""

    user_prompt = f"""Context:
{context}

Question: {query}

Answer based only on the context above:"""

    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.7,
        max_tokens=500
    )

    end_time = time.time()
    time_ms = int((end_time - start_time) * 1000)

    reply = response.choices[0].message.content
    tokens = response.usage.total_tokens if response.usage else 0

    stats = GenerationStats(
        tokens=tokens,
        time_ms=time_ms
    )

    return reply, stats

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Main chat endpoint that handles RAG flow:
    1. Embed user question
    2. Retrieve relevant documents from Pinecone
    3. Generate response using GPT-4o-mini
    Returns response with metadata about each pipeline stage
    """
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    try:
        # Step 1: Generate embedding
        query_embedding, embedding_stats = embed_query(request.question)

        # Step 2: Retrieve relevant documents
        relevant_docs, retrieval_matches = retrieve_relevant_docs(query_embedding, k=3)

        if not relevant_docs:
            # Return empty metadata if no docs found
            return ChatResponse(
                reply="I don't have any information to answer that question.",
                metadata=ChatMetadata(
                    embedding_stats=embedding_stats,
                    retrieval_stats=[],
                    generation_stats=GenerationStats(tokens=0, time_ms=0)
                )
            )

        # Step 3: Generate response
        reply, generation_stats = generate_response(request.question, relevant_docs)

        return ChatResponse(
            reply=reply,
            metadata=ChatMetadata(
                embedding_stats=embedding_stats,
                retrieval_stats=retrieval_matches,
                generation_stats=generation_stats
            )
        )

    except Exception as e:
        print(f"Error processing chat request: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while processing your request")

@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "NicoBot API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)