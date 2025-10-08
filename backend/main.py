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
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="NicoBot API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://*.vercel.app",
        os.getenv("FRONTEND_URL", "*")
    ],
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

class Panel(BaseModel):
    type: str  # 'linkedin', 'github', 'email', 'project', 'resume', 'link'
    title: str
    subtitle: str | None = None
    url: str | None = None
    icon: str | None = None
    action: str | None = None

class EmbeddingStats(BaseModel):
    dimension: int
    norm: float
    active_dimensions: int
    sample_values: list[float]  # First 10 dimensions for geek mode
    time_ms: int
    model: str  # Embedding model used
    sparsity: float  # Percentage of near-zero values

class RetrievalMatch(BaseModel):
    score: float
    doc_id: str
    snippet: str  # First 200 chars of document for geek mode

class GenerationStats(BaseModel):
    tokens: int
    time_ms: int
    model: str  # LLM model used
    prompt_tokens: int
    completion_tokens: int

class ChatMetadata(BaseModel):
    embedding_stats: EmbeddingStats
    retrieval_stats: list[RetrievalMatch]
    generation_stats: GenerationStats
    confidence_score: float  # Average of retrieval scores (0-1)
    total_time_ms: int  # Total pipeline time
    retrieval_time_ms: int  # Time spent on vector search

class ChatResponse(BaseModel):
    reply: str
    metadata: ChatMetadata
    panels: list[Panel] = []

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
    import time
    import math

    embedding_model = "text-embedding-3-small"
    start_time = time.time()
    response = openai_client.embeddings.create(
        model=embedding_model,
        input=[query]
    )
    embedding = response.data[0].embedding
    end_time = time.time()

    # Calculate stats
    norm = math.sqrt(sum(x * x for x in embedding))
    active_dims = sum(1 for x in embedding if abs(x) > 0.01)  # Count significant dimensions
    near_zero = sum(1 for x in embedding if abs(x) < 0.001)  # Count near-zero values
    sparsity = (near_zero / len(embedding)) * 100  # Sparsity percentage

    stats = EmbeddingStats(
        dimension=len(embedding),
        norm=round(norm, 4),
        active_dimensions=active_dims,
        sample_values=[round(x, 6) for x in embedding[:10]],  # First 10 dimensions
        time_ms=int((end_time - start_time) * 1000),
        model=embedding_model,
        sparsity=round(sparsity, 2)
    )

    return embedding, stats

def retrieve_relevant_docs(query_embedding: list[float], k: int = 3) -> tuple[list[str], list[RetrievalMatch], int]:
    """Retrieve top k relevant documents from Pinecone and return stats."""
    import time

    start_time = time.time()
    # Query Pinecone
    results = pinecone_index.query(
        vector=query_embedding,
        top_k=k,
        include_metadata=True
    )
    end_time = time.time()
    retrieval_time_ms = int((end_time - start_time) * 1000)

    # Extract content and match stats from results
    relevant_docs = []
    retrieval_matches = []
    for i, match in enumerate(results.matches):
        if match.metadata and "content" in match.metadata:
            content = match.metadata["content"]
            relevant_docs.append(content)
            retrieval_matches.append(RetrievalMatch(
                score=round(match.score, 4),
                doc_id=match.id if hasattr(match, 'id') else f"doc_{i}",
                snippet=content[:200] + "..." if len(content) > 200 else content
            ))

    return relevant_docs, retrieval_matches, retrieval_time_ms

def detect_intent_and_generate_panels(query: str) -> tuple[list[Panel], bool]:
    """Detect user intent and generate appropriate panels based on query.
    Returns (panels, has_contact_intent) where has_contact_intent indicates if this is a contact-related query."""
    panels = []
    query_lower = query.lower()
    has_contact_intent = False

    # LinkedIn intent
    if any(keyword in query_lower for keyword in ['linkedin', 'connect', 'network', 'professional profile']):
        panels.append(Panel(
            type='linkedin',
            title='Connect with Nico on LinkedIn',
            subtitle='View professional experience and network',
            url='https://www.linkedin.com/in/nico-bourel-09237a216/'
        ))
        has_contact_intent = True

    # GitHub intent
    if any(keyword in query_lower for keyword in ['github', 'code', 'repository', 'repos', 'projects', 'source']):
        panels.append(Panel(
            type='github',
            title="Nico's GitHub Profile",
            subtitle='Explore code repositories and contributions',
            url='https://github.com/nicobourel'
        ))
        has_contact_intent = True

    # Email/Contact intent
    if any(keyword in query_lower for keyword in ['email', 'contact', 'reach', 'message', 'get in touch']):
        panels.append(Panel(
            type='email',
            title='Email Nico',
            subtitle='nico.bourel@example.com',
            url='mailto:nico.bourel@example.com'
        ))
        has_contact_intent = True

    return panels, has_contact_intent

def generate_response(query: str, context_docs: list[str], has_contact_intent: bool = False) -> tuple[str, GenerationStats]:
    """Generate response using GPT-4o-mini with retrieved context and return stats."""
    import time
    start_time = time.time()

    context = "\n\n".join(context_docs)
    generation_model = "gpt-4o-mini"

    system_prompt = """You are Nico Bourel's portfolio assistant. Your role is to help visitors learn about Nico's background, skills, projects, and experience.

Use ONLY the provided context to answer questions.

IMPORTANT: If the user's message is very short (like "yes", "ok", "sure", "thanks", "cool") or is clearly a conversational acknowledgment rather than a real question, respond naturally and offer to help with something specific about Nico. Examples:
- "Great! Is there anything specific you'd like to know about Nico's projects?"
- "Awesome! Feel free to ask me about Nico's skills or experience."

CONTACT QUESTIONS: If the user asks about LinkedIn, GitHub, email, or how to contact Nico, respond warmly and mention that you've provided a clickable link below. Examples:
- "Sure! I've provided Nico's LinkedIn profile below - just click to connect with him!"
- "You can find Nico on GitHub! I've included a link to his profile below."
- "I've shared Nico's contact information below. Feel free to reach out!"

If the answer to a real question is not in the context, respond with a friendly refusal that redirects to what you DO know about Nico. Choose from variations like:
- "I can only talk about Nico and his work — want to hear about his AI internship?"
- "I'm not trained on that, but I can show you Nico's projects instead."
- "That's outside my knowledge, but I'd love to tell you about Nico's experience with [relevant skill]."

Keep the recruiter engaged. Be friendly, concise, and helpful. When discussing projects, highlight the technologies and skills involved."""

    # Add hint if this is a contact question
    contact_hint = ""
    if has_contact_intent:
        contact_hint = "\n\nNOTE: This is a contact/social media question. You MUST respond positively and mention the clickable link provided below. DO NOT say you can't provide this information."

    user_prompt = f"""Context:
{context}

Question: {query}{contact_hint}

Answer based only on the context above:"""

    response = openai_client.chat.completions.create(
        model=generation_model,
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
    prompt_tokens = response.usage.prompt_tokens if response.usage else 0
    completion_tokens = response.usage.completion_tokens if response.usage else 0
    total_tokens = response.usage.total_tokens if response.usage else 0

    stats = GenerationStats(
        tokens=total_tokens,
        time_ms=time_ms,
        model=generation_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens
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
        import time
        pipeline_start = time.time()

        # Step 1: Generate embedding
        query_embedding, embedding_stats = embed_query(request.question)

        # Step 2: Retrieve relevant documents
        relevant_docs, retrieval_matches, retrieval_time_ms = retrieve_relevant_docs(query_embedding, k=3)

        if not relevant_docs:
            # Return empty metadata if no docs found
            total_time = int((time.time() - pipeline_start) * 1000)
            return ChatResponse(
                reply="I don't have any information to answer that question.",
                metadata=ChatMetadata(
                    embedding_stats=embedding_stats,
                    retrieval_stats=[],
                    generation_stats=GenerationStats(
                        tokens=0,
                        time_ms=0,
                        model="gpt-4o-mini",
                        prompt_tokens=0,
                        completion_tokens=0
                    ),
                    confidence_score=0.0,
                    total_time_ms=total_time,
                    retrieval_time_ms=retrieval_time_ms
                )
            )

        # Step 3: Detect intent and generate panels first
        panels, has_contact_intent = detect_intent_and_generate_panels(request.question)
        print(f"DEBUG: Query: {request.question}")
        print(f"DEBUG: Detected {len(panels)} panels, has_contact_intent={has_contact_intent}")
        for panel in panels:
            print(f"DEBUG: Panel type={panel.type}, title={panel.title}")

        # Step 4: Generate response with context about whether we're showing contact panels
        reply, generation_stats = generate_response(request.question, relevant_docs, has_contact_intent)

        # Calculate confidence score (average of retrieval scores)
        confidence_score = sum(match.score for match in retrieval_matches) / len(retrieval_matches) if retrieval_matches else 0.0

        # Calculate total pipeline time
        total_time = int((time.time() - pipeline_start) * 1000)

        return ChatResponse(
            reply=reply,
            metadata=ChatMetadata(
                embedding_stats=embedding_stats,
                retrieval_stats=retrieval_matches,
                generation_stats=generation_stats,
                confidence_score=round(confidence_score, 4),
                total_time_ms=total_time,
                retrieval_time_ms=retrieval_time_ms
            ),
            panels=panels
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