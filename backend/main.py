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

class ChatResponse(BaseModel):
    reply: str

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

def embed_query(query: str) -> list[float]:
    """Generate embedding for a query using OpenAI."""
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=[query]
    )
    return response.data[0].embedding

def retrieve_relevant_docs(query: str, k: int = 3) -> list[str]:
    """Retrieve top k relevant documents from Pinecone."""
    # Generate query embedding
    query_embedding = embed_query(query)

    # Query Pinecone
    results = pinecone_index.query(
        vector=query_embedding,
        top_k=k,
        include_metadata=True
    )

    # Extract content from results
    relevant_docs = []
    for match in results.matches:
        if match.metadata and "content" in match.metadata:
            relevant_docs.append(match.metadata["content"])

    return relevant_docs

def generate_response(query: str, context_docs: list[str]) -> str:
    """Generate response using GPT-4o-mini with retrieved context."""
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

    return response.choices[0].message.content

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Main chat endpoint that handles RAG flow:
    1. Embed user question
    2. Retrieve relevant documents from Pinecone
    3. Generate response using GPT-4o-mini
    """
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    try:
        # Retrieve relevant documents
        relevant_docs = retrieve_relevant_docs(request.question, k=3)

        if not relevant_docs:
            return ChatResponse(reply="I don't have any information to answer that question.")

        # Generate response
        reply = generate_response(request.question, relevant_docs)

        return ChatResponse(reply=reply)

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