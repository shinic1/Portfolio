"""
FastAPI backend for NicoBot portfolio chatbot.
Provides /chat endpoint for RAG-based question answering using Pinecone.
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator, ValidationError
from contextlib import asynccontextmanager
import os
import re
import json
import traceback
from openai import OpenAI
from pinecone import Pinecone
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables
load_dotenv(override=True)

# Initialize clients
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

# Model configuration is centralized in config.py so the API and the embedding
# uploader (embeddings_pinecone.py) always use the same models and dimension.
from config import (
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSION,
    GENERATION_MODEL,
    GENERATION_MAX_COMPLETION_TOKENS,
    GENERATION_REASONING_EFFORT,
)

# Pinecone index
INDEX_NAME = "nicobot-portfolio"
LINKEDIN_URL = "https://www.linkedin.com/in/nico-bourel-09237a216/"
GITHUB_URL = "https://github.com/shinic1"
CONTACT_EMAIL = "nico.bourel@swedev.online"
RESUME_URL = "/resume"
pinecone_index = None

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)

# Lifespan event handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    # Startup: Connect to Pinecone
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

    yield

    # Shutdown: cleanup if needed
    print("Shutting down...")

# Initialize FastAPI app with lifespan
app = FastAPI(title="NicoBot API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Global exception handler to ensure CORS headers on all errors
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all exceptions and return with CORS headers."""
    error_detail = str(exc)
    error_traceback = traceback.format_exc()
    print(f"ERROR: {error_detail}")
    print(f"TRACEBACK:\n{error_traceback}")

    return JSONResponse(
        status_code=500,
        content={"detail": error_detail, "type": type(exc).__name__},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
    )

# Configure CORS - Fully permissive for debugging
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=False,  # Must be False when allow_origins=["*"]
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
    expose_headers=["*"],  # Expose all response headers
)

class ChatMessage(BaseModel):
    """A single prior conversation turn, used for context-aware retrieval and generation."""
    role: str
    # Generous hard ceiling guards against abuse; normal replies are truncated (not
    # rejected) in the validator below so a long prior turn never 422s the next request.
    content: str = Field(..., max_length=16000)

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str):
        if v not in ('user', 'assistant'):
            raise ValueError("role must be 'user' or 'assistant'")
        return v

    @field_validator('content')
    @classmethod
    def sanitize_content(cls, v: str):
        # Strip control characters but keep normal text, then bound the length so
        # prompts stay reasonable without ever rejecting a slightly-long turn.
        v = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', v)
        return v[:8000]


class ChatRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="User's question (1-500 characters)"
    )
    history: list[ChatMessage] = Field(
        default_factory=list,
        description="Recent conversation turns for context (most recent last)"
    )

    @field_validator('history')
    @classmethod
    def cap_history(cls, v: list):
        # Keep only the most recent turns to bound prompt size
        return v[-12:]

    @field_validator('question')
    @classmethod
    def validate_question(cls, v: str):
        # Remove leading/trailing whitespace
        v = v.strip()

        # Check if empty after stripping
        if not v:
            raise ValueError("Question cannot be empty or only whitespace")

        # Check for excessive whitespace (potential spam)
        if len(v.split()) > 100:
            raise ValueError("Question is too long (max 100 words)")

        # Basic sanitization - remove control characters but keep newlines/tabs
        v = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', v)

        # Check for suspicious patterns (basic injection prevention)
        suspicious_patterns = [
            r'<script',
            r'javascript:',
            r'onerror=',
            r'onclick=',
            r'on\w+='
        ]
        for pattern in suspicious_patterns:
            if re.search(pattern, v, re.IGNORECASE):
                raise ValueError("Question contains invalid content")

        return v

class Panel(BaseModel):
    type: str  # 'linkedin', 'github', 'email', 'project', 'resume', 'link', 'suggestion'
    title: str
    subtitle: str | None = None
    url: str | None = None
    icon: str | None = None
    action: str | None = None
    is_question: bool = False  # True for clickable question suggestions

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

def embed_query(query: str) -> tuple[list[float], EmbeddingStats]:
    """Generate embedding for a query using OpenAI and return stats."""
    import time
    import math

    start_time = time.time()
    response = openai_client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=[query],
        dimensions=EMBEDDING_DIMENSION
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
        model=EMBEDDING_MODEL,
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
            url=LINKEDIN_URL
        ))
        has_contact_intent = True

    # GitHub intent
    if any(keyword in query_lower for keyword in ['github', 'code', 'repository', 'repos', 'projects', 'source']):
        panels.append(Panel(
            type='github',
            title="Nico's GitHub Profile",
            subtitle='Explore code repositories and contributions',
            url=GITHUB_URL
        ))
        has_contact_intent = True

    # Email/Contact intent
    if any(keyword in query_lower for keyword in ['email', 'contact', 'reach', 'message', 'get in touch']):
        panels.append(Panel(
            type='email',
            title='Email Nico',
            subtitle=CONTACT_EMAIL,
            url=f'mailto:{CONTACT_EMAIL}'
        ))
        has_contact_intent = True

    # Resume intent
    if any(keyword in query_lower for keyword in ['resume', 'cv']):
        panels.append(Panel(
            type='resume',
            title="View Nico's Resume",
            subtitle='Open the full resume',
            url=RESUME_URL
        ))
        has_contact_intent = True

    return panels, has_contact_intent

def should_use_shortcut_response(query: str, panels: list[Panel]) -> bool:
    """Use deterministic responses for simple recruiter actions that don't need RAG."""
    query_lower = query.lower()

    if not panels:
        return False

    shortcut_keywords = [
        'linkedin', 'github', 'email', 'contact', 'reach', 'get in touch',
        'resume', 'cv', 'phone', 'call'
    ]
    rag_keywords = [
        'experience', 'work', 'role', 'internship', 'project', 'projects',
        'skill', 'skills', 'technology', 'technologies', 'education',
        'major', 'graduate', 'studying', 'background'
    ]

    token_count = len(query_lower.split())
    has_shortcut_keyword = any(keyword in query_lower for keyword in shortcut_keywords)
    has_rag_keyword = any(keyword in query_lower for keyword in rag_keywords)

    return has_shortcut_keyword and token_count <= 12 and not has_rag_keyword

def build_shortcut_reply(panels: list[Panel]) -> str:
    """Return a deterministic reply for simple contact and resume requests."""
    panel_types = {panel.type for panel in panels}

    if panel_types == {'email'}:
        return "I've included Nico's email below so you can reach him directly."
    if panel_types == {'linkedin'}:
        return "I've included Nico's LinkedIn profile below."
    if panel_types == {'github'}:
        return "I've included Nico's GitHub profile below."
    if panel_types == {'resume'}:
        return "I've included Nico's resume below."

    resources = []
    if 'linkedin' in panel_types:
        resources.append('LinkedIn')
    if 'github' in panel_types:
        resources.append('GitHub')
    if 'email' in panel_types:
        resources.append('email')
    if 'resume' in panel_types:
        resources.append('resume')

    if len(resources) == 2:
        resource_text = f"{resources[0]} and {resources[1]}"
    else:
        resource_text = ", ".join(resources[:-1]) + f", and {resources[-1]}" if len(resources) > 2 else resources[0]

    return f"I've included Nico's {resource_text} below."

def build_shortcut_metadata(total_time_ms: int) -> ChatMetadata:
    """Return metadata for deterministic shortcut responses."""
    return ChatMetadata(
        embedding_stats=EmbeddingStats(
            dimension=0,
            norm=0.0,
            active_dimensions=0,
            sample_values=[],
            time_ms=0,
            model="shortcut",
            sparsity=0.0
        ),
        retrieval_stats=[],
        generation_stats=GenerationStats(
            tokens=0,
            time_ms=0,
            model="shortcut",
            prompt_tokens=0,
            completion_tokens=0
        ),
        confidence_score=0.0,
        total_time_ms=total_time_ms,
        retrieval_time_ms=0
    )

def extract_topics_from_docs(retrieval_matches: list) -> list[str]:
    """Extract main topics from retrieved document IDs (e.g., 'experience', 'skills', 'education')."""
    topics = set()
    for match in retrieval_matches:
        # Parse doc_id like "experience_1", "skills_2", etc.
        if hasattr(match, 'doc_id') and '_' in match.doc_id:
            topic = match.doc_id.split('_')[0]
            topics.add(topic)
    return list(topics)

# Rule-based suggestion mappings: short, concise follow-up questions
TOPIC_SUGGESTIONS = {
    'experience': [
        "What does he do at AnSer AI?",
        "How did he go from intern to full-time?",
        "Tell me about the recruiting platform he built",
        "What network or infrastructure work has he done?",
        "What has he shipped to production?"
    ],
    'skills': [
        "What languages does he know?",
        "Does he know React?",
        "Has he worked with voice AI?",
        "Is he comfortable with databases?",
        "What about infrastructure and security?"
    ],
    'education': [
        "What did he study?",
        "What's his degree?",
        "Where did he go to school?",
        "What's his major?",
        "Tell me about his education"
    ],
    'availability': [
        "Where is he based?",
        "What roles is he looking for?",
        "Is he authorized to work in the US?"
    ],
    'contact': [
        "How can I reach him?",
        "Does he have LinkedIn?",
        "What's his email?",
        "Can I see his GitHub?"
    ],
    'project': [
        "Tell me about NicoBot",
        "What is the Jarvis assistant?",
        "How does the portfolio RAG work?",
        "What's his most technical project?",
        "What has he built outside of work?"
    ],
    'ownership': [
        "Which projects are personal?",
        "What did he build at AnSer AI?",
        "What can he show publicly?"
    ]
}

# Default suggestions for when no specific topics are retrieved
DEFAULT_SUGGESTIONS = [
    "Tell me about NicoBot",
    "What did he build at AnSer AI?",
    "What is the Jarvis assistant?"
]

def generate_follow_up_suggestions(query: str, reply: str, retrieval_matches: list) -> list[Panel]:
    """Generate rule-based follow-up suggestions based on retrieved topics.
    Returns short, concise questions relevant to the conversation context."""

    # Extract topics from retrieved documents
    topics = extract_topics_from_docs(retrieval_matches)

    if not topics:
        # No topics found, use defaults
        questions = DEFAULT_SUGGESTIONS
    else:
        # Collect questions from all retrieved topics
        available_questions = []
        for topic in topics:
            if topic in TOPIC_SUGGESTIONS:
                available_questions.extend(TOPIC_SUGGESTIONS[topic])

        # Also add questions from related topics for variety
        all_topic_keys = list(TOPIC_SUGGESTIONS.keys())
        for topic_key in all_topic_keys:
            if topic_key not in topics:
                # Add one question from each other topic for exploration
                if TOPIC_SUGGESTIONS[topic_key]:
                    available_questions.append(TOPIC_SUGGESTIONS[topic_key][0])

        # Remove duplicates while preserving order
        seen = set()
        unique_questions = []
        for q in available_questions:
            if q.lower() not in seen:
                seen.add(q.lower())
                unique_questions.append(q)

        # Select 3 questions (prioritize questions from retrieved topics)
        if len(unique_questions) >= 3:
            questions = unique_questions[:3]
        else:
            # Fallback to defaults if not enough questions
            questions = (unique_questions + DEFAULT_SUGGESTIONS)[:3]

    # Convert to Panel objects
    panels = []
    for question in questions:
        panels.append(Panel(
            type='suggestion',
            title=question,
            action='Ask this',
            is_question=True
        ))

    return panels

def build_retrieval_query(query: str, history: list | None = None) -> str:
    """Combine the current question with recent user turns so follow-ups like
    "tell me how he applied it" retrieve the right context instead of nothing."""
    history = history or []
    prior_user_turns = [m.content for m in history if getattr(m, "role", None) == "user"][-2:]
    combined = " ".join(prior_user_turns + [query]).strip()
    return combined[:1000]

def strip_echoed_question(history: list | None, question: str) -> list:
    """Drop a trailing user turn identical to the current question so a client that
    echoes the current turn into history doesn't cause it to be sent twice."""
    history = history or []
    if (history and getattr(history[-1], "role", None) == "user"
            and (history[-1].content or "").strip() == (question or "").strip()):
        return history[:-1]
    return history


# Shared system prompt for both the streaming and non-streaming generation paths.
SYSTEM_PROMPT = """You are Nico Bourel's portfolio assistant, a friendly guide that helps recruiters and hiring managers learn about Nico's background, skills, projects, and experience.

Ground every answer in the provided context and the conversation so far. Do not invent details the context does not support.

CONVERSATION AWARENESS: Use the conversation history to resolve references. If the user asks a short follow-up or says "it", "that", "those", "how did he apply it", and so on, work out what they mean from the previous turns and answer it directly. A follow-up that builds on something already discussed is ALWAYS on-topic - never refuse it.

SCOPE: You only discuss Nico - his work, skills, projects, education, and how to reach him. Only if a question is clearly unrelated to Nico (general trivia, coding help, other people) give a brief, friendly redirect back to what you can share about Nico. Never use that redirect for a genuine question about Nico; if a specific detail isn't in the context, share the closest relevant thing you do know instead.

REPRESENTING NICO: You represent Nico to recruiters, so you are on his side. NEVER invent, speculate about, or list his weaknesses, red flags, gaps, concerns, or reasons not to hire him - not even as "possible concerns to verify". If asked for weaknesses/red flags, say you can't speak to weaknesses and redirect to his demonstrated strengths and how he'd fit the role. Don't disparage him or rank him against other candidates. If asked for facts that simply aren't in the context (e.g., salary, work authorization, references), say you don't have that detail and point them to his contact links - never guess or fabricate it.

SHORT REPLIES: If the user just acknowledges ("yes", "ok", "sure", "thanks", "cool"), don't repeat your previous message. Either deliver what you just offered or suggest a specific new thing to explore about Nico.

CONTACT: If the user asks about LinkedIn, GitHub, email, the resume, or how to reach Nico, respond warmly and point them to the clickable link shown below your message.

STYLE: Be friendly, concise, and specific. Lead with the answer. When discussing projects or experience, highlight concrete technologies and any outcomes or metrics. Vary your wording - avoid repeating the same canned sentence."""


def build_generation_messages(query: str, context_docs: list[str], has_contact_intent: bool = False, history: list | None = None) -> list[dict]:
    """Assemble the chat messages (system prompt, recent turns, then the current
    question with retrieved context) shared by both generation paths."""
    history = history or []
    context = "\n\n".join(context_docs)

    contact_hint = ""
    if has_contact_intent:
        contact_hint = "\n\nNOTE: This is a contact/social question. Respond positively and mention the clickable link provided below. Do not say you can't share this."

    user_prompt = f"""Information about Nico:
{context}

Using the information above and our conversation so far, answer this question: {query}{contact_hint}"""

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in history[-6:]:
        role = getattr(turn, "role", None)
        content = getattr(turn, "content", None)
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_prompt})
    return messages


# GPT-5 generation: use max_completion_tokens (not max_tokens), leave temperature at
# its default, and pass reasoning_effort via extra_body so it works regardless of the
# installed SDK version. These kwargs are shared by both generation paths.
def _generation_kwargs(messages: list[dict]) -> dict:
    return {
        "model": GENERATION_MODEL,
        "messages": messages,
        "max_completion_tokens": GENERATION_MAX_COMPLETION_TOKENS,
        "extra_body": {"reasoning_effort": GENERATION_REASONING_EFFORT},
    }


_EMPTY_REPLY_FALLBACK = "Sorry, I couldn't generate a response just now - could you rephrase that?"


def generate_response(query: str, context_docs: list[str], has_contact_intent: bool = False, history: list | None = None) -> tuple[str, GenerationStats]:
    """Generate a grounded response with the configured chat model and return stats."""
    import time
    start_time = time.time()

    messages = build_generation_messages(query, context_docs, has_contact_intent, history)
    response = openai_client.chat.completions.create(**_generation_kwargs(messages))

    time_ms = int((time.time() - start_time) * 1000)
    reply = response.choices[0].message.content or _EMPTY_REPLY_FALLBACK
    usage = response.usage
    stats = GenerationStats(
        tokens=usage.total_tokens if usage else 0,
        time_ms=time_ms,
        model=GENERATION_MODEL,
        prompt_tokens=usage.prompt_tokens if usage else 0,
        completion_tokens=usage.completion_tokens if usage else 0,
    )
    return reply, stats


def stream_generation(query: str, context_docs: list[str], has_contact_intent: bool = False, history: list | None = None):
    """Stream the chat model's answer. Yields {'type':'token','text':...} per token and
    finally {'type':'generation_done','stats':GenerationStats,'reply':full_text}."""
    import time
    start_time = time.time()

    messages = build_generation_messages(query, context_docs, has_contact_intent, history)
    stream = openai_client.chat.completions.create(
        **_generation_kwargs(messages),
        stream=True,
        stream_options={"include_usage": True},
    )

    full = ""
    usage = None
    for chunk in stream:
        if chunk.choices:
            text = getattr(chunk.choices[0].delta, "content", None)
            if text:
                full += text
                yield {"type": "token", "text": text}
        if getattr(chunk, "usage", None):
            usage = chunk.usage

    if not full:
        full = _EMPTY_REPLY_FALLBACK
        yield {"type": "token", "text": full}

    time_ms = int((time.time() - start_time) * 1000)
    stats = GenerationStats(
        tokens=usage.total_tokens if usage else 0,
        time_ms=time_ms,
        model=GENERATION_MODEL,
        prompt_tokens=usage.prompt_tokens if usage else 0,
        completion_tokens=usage.completion_tokens if usage else 0,
    )
    yield {"type": "generation_done", "stats": stats, "reply": full}

@app.post("/chat", response_model=ChatResponse)
@limiter.limit("20/minute")
async def chat(request: Request, chat_request: ChatRequest):
    """
    Main chat endpoint that handles RAG flow:
    1. Embed user question (context-aware, using recent conversation history)
    2. Retrieve relevant documents from Pinecone
    3. Generate response using the configured chat model
    Returns response with metadata about each pipeline stage
    """
    if not chat_request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    try:
        import time
        pipeline_start = time.time()

        # Step 0: Detect contact/social intent before paying the RAG latency cost
        panels, has_contact_intent = detect_intent_and_generate_panels(chat_request.question)
        if should_use_shortcut_response(chat_request.question, panels):
            suggestion_panels = [
                Panel(type='suggestion', title=question, action='Ask this', is_question=True)
                for question in TOPIC_SUGGESTIONS['contact'][:3]
            ]
            total_time = int((time.time() - pipeline_start) * 1000)
            return ChatResponse(
                reply=build_shortcut_reply(panels),
                metadata=build_shortcut_metadata(total_time),
                panels=panels + suggestion_panels
            )

        # Drop a trailing history turn identical to the current question so a client
        # that echoes the current turn into history doesn't cause it to be sent twice.
        convo_history = strip_echoed_question(chat_request.history, chat_request.question)

        # Step 1: Generate embedding (context-aware so follow-ups retrieve correctly)
        retrieval_query = build_retrieval_query(chat_request.question, convo_history)
        query_embedding, embedding_stats = embed_query(retrieval_query)

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
                        model=GENERATION_MODEL,
                        prompt_tokens=0,
                        completion_tokens=0
                    ),
                    confidence_score=0.0,
                    total_time_ms=total_time,
                    retrieval_time_ms=retrieval_time_ms
                )
            )

        # Step 3: Panels were already detected before RAG and are reused here
        print(f"DEBUG: Query: {chat_request.question}")
        print(f"DEBUG: Detected {len(panels)} panels, has_contact_intent={has_contact_intent}")
        for panel in panels:
            print(f"DEBUG: Panel type={panel.type}, title={panel.title}")

        # Step 4: Generate response with conversation history and contact context
        reply, generation_stats = generate_response(
            chat_request.question, relevant_docs, has_contact_intent, convo_history
        )

        # Step 5: Generate contextual follow-up suggestions
        suggestion_panels = generate_follow_up_suggestions(chat_request.question, reply, retrieval_matches)
        print(f"DEBUG: Generated {len(suggestion_panels)} follow-up suggestions")

        # Combine contact panels and suggestion panels
        all_panels = panels + suggestion_panels

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
            panels=all_panels
        )

    except Exception as e:
        print(f"Error processing chat request: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while processing your request")

def _sse(payload: dict) -> str:
    """Format a dict as a Server-Sent Events data frame."""
    return f"data: {json.dumps(payload)}\n\n"


@app.post("/chat/stream")
@limiter.limit("20/minute")
async def chat_stream(request: Request, chat_request: ChatRequest):
    """Streaming variant of /chat using Server-Sent Events. Emits real pipeline
    events (embedding -> retrieval -> generation tokens -> done) so the UI can show
    live tokens and honest stage timings instead of simulated ones."""
    if not chat_request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    def event_generator():
        import time
        pipeline_start = time.time()
        try:
            # Step 0: contact/social shortcut (no RAG needed)
            panels, has_contact_intent = detect_intent_and_generate_panels(chat_request.question)
            if should_use_shortcut_response(chat_request.question, panels):
                suggestion_panels = [
                    Panel(type='suggestion', title=q, action='Ask this', is_question=True)
                    for q in TOPIC_SUGGESTIONS['contact'][:3]
                ]
                reply = build_shortcut_reply(panels)
                yield _sse({"type": "token", "text": reply})
                total_time = int((time.time() - pipeline_start) * 1000)
                yield _sse({
                    "type": "done",
                    "reply": reply,
                    "metadata": build_shortcut_metadata(total_time).model_dump(),
                    "panels": [p.model_dump() for p in panels + suggestion_panels],
                })
                return

            convo_history = strip_echoed_question(chat_request.history, chat_request.question)

            # Step 1: embedding
            retrieval_query = build_retrieval_query(chat_request.question, convo_history)
            query_embedding, embedding_stats = embed_query(retrieval_query)
            yield _sse({"type": "embedding", "embedding_stats": embedding_stats.model_dump()})

            # Step 2: retrieval
            relevant_docs, retrieval_matches, retrieval_time_ms = retrieve_relevant_docs(query_embedding, k=3)
            yield _sse({
                "type": "retrieval",
                "retrieval_stats": [m.model_dump() for m in retrieval_matches],
                "retrieval_time_ms": retrieval_time_ms,
            })

            if not relevant_docs:
                reply = "I don't have any information to answer that question."
                yield _sse({"type": "token", "text": reply})
                total_time = int((time.time() - pipeline_start) * 1000)
                metadata = ChatMetadata(
                    embedding_stats=embedding_stats,
                    retrieval_stats=[],
                    generation_stats=GenerationStats(tokens=0, time_ms=0, model=GENERATION_MODEL, prompt_tokens=0, completion_tokens=0),
                    confidence_score=0.0,
                    total_time_ms=total_time,
                    retrieval_time_ms=retrieval_time_ms,
                )
                yield _sse({"type": "done", "reply": reply, "metadata": metadata.model_dump(), "panels": []})
                return

            # Step 3: streaming generation
            reply = ""
            generation_stats = None
            for ev in stream_generation(chat_request.question, relevant_docs, has_contact_intent, convo_history):
                if ev["type"] == "token":
                    reply += ev["text"]
                    yield _sse({"type": "token", "text": ev["text"]})
                elif ev["type"] == "generation_done":
                    generation_stats = ev["stats"]
                    reply = ev["reply"]

            # Step 4: panels + metadata
            suggestion_panels = generate_follow_up_suggestions(chat_request.question, reply, retrieval_matches)
            all_panels = panels + suggestion_panels
            confidence = sum(m.score for m in retrieval_matches) / len(retrieval_matches) if retrieval_matches else 0.0
            total_time = int((time.time() - pipeline_start) * 1000)
            metadata = ChatMetadata(
                embedding_stats=embedding_stats,
                retrieval_stats=retrieval_matches,
                generation_stats=generation_stats,
                confidence_score=round(confidence, 4),
                total_time_ms=total_time,
                retrieval_time_ms=retrieval_time_ms,
            )
            yield _sse({
                "type": "done",
                "reply": reply,
                "metadata": metadata.model_dump(),
                "panels": [p.model_dump() for p in all_panels],
            })
        except Exception as e:
            print(f"Error processing chat stream: {e}")
            yield _sse({"type": "error", "detail": "An error occurred while processing your request"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "NicoBot API is running"}

@app.get("/warmup")
async def warmup():
    """Warm the backend and Pinecone query path on page load."""
    import time

    if pinecone_index is None:
        raise HTTPException(status_code=503, detail="Pinecone index is not ready")

    start_time = time.time()
    # Cosine similarity is undefined for an all-zero vector (some Pinecone versions
    # reject it), so warm with a tiny non-zero vector instead.
    warm_vector = [0.0] * EMBEDDING_DIMENSION
    warm_vector[0] = 0.001
    pinecone_index.query(
        vector=warm_vector,
        top_k=1,
        include_metadata=False
    )
    total_time_ms = int((time.time() - start_time) * 1000)

    return {
        "status": "ok",
        "message": "Warm-up completed",
        "pinecone_query_time_ms": total_time_ms
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
