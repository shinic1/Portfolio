import type {
  ChatMessage,
  ChatMetadata,
  ChatResponse,
  GenerationStats,
  Panel,
  RetrievalMatch,
} from "./contracts";
import {
  buildGenerationMessages,
  buildRetrievalQuery,
  buildShortcutMetadata,
  buildShortcutReply,
  detectIntentAndGeneratePanels,
  embeddingStats,
  emptyGenerationStats,
  generateFollowUpSuggestions,
  GENERATION_MODEL,
  parseChatRequest,
  shouldUseShortcutResponse,
  stripEchoedQuestion,
  TOPIC_SUGGESTIONS,
} from "./portfolio";
import {
  createCompletion,
  createCompletionStream,
  createEmbedding,
} from "./openai";

interface Env {
  VECTORIZE: Vectorize;
  CHAT_RATE_LIMITER: RateLimit;
  OPENAI_API_KEY: string;
}

type RetrievedDocs = {
  documents: string[];
  matches: RetrievalMatch[];
  timeMs: number;
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders() },
  });
}

function sse(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

async function retrieveDocuments(
  env: Env,
  vector: number[],
  topK = 3,
): Promise<RetrievedDocs> {
  const startedAt = Date.now();
  const result = await env.VECTORIZE.query(vector, {
    topK,
    returnMetadata: "all",
  });
  const matches = result.matches.flatMap<RetrievalMatch>((match) => {
    const content = match.metadata?.content;
    if (typeof content !== "string") return [];
    return [
      {
        score: Number(match.score.toFixed(4)),
        doc_id: match.id,
        snippet:
          content.length > 200 ? `${content.slice(0, 200)}...` : content,
      },
    ];
  });
  const documents = result.matches.flatMap<string>((match) => {
    const content = match.metadata?.content;
    return typeof content === "string" ? [content] : [];
  });
  return { documents, matches, timeMs: Date.now() - startedAt };
}

function confidenceScore(matches: RetrievalMatch[]) {
  if (matches.length === 0) return 0;
  const average =
    matches.reduce((total, match) => total + match.score, 0) / matches.length;
  return Number(average.toFixed(4));
}

function suggestionPanelsForShortcut() {
  return TOPIC_SUGGESTIONS.contact.slice(0, 3).map<Panel>((question) => ({
    type: "suggestion",
    title: question,
    action: "Ask this",
    is_question: true,
  }));
}

async function prepareRag(
  env: Env,
  question: string,
  history: ChatMessage[],
) {
  const retrievalQuery = buildRetrievalQuery(question, history);
  const embeddingStartedAt = Date.now();
  const vector = await createEmbedding(env.OPENAI_API_KEY, retrievalQuery);
  const embedding = embeddingStats(vector, Date.now() - embeddingStartedAt);
  const retrieval = await retrieveDocuments(env, vector);
  return { embedding, retrieval };
}

async function handleChat(request: Request, env: Env) {
  const pipelineStartedAt = Date.now();
  const chatRequest = parseChatRequest(await request.json());
  const { panels, hasContactIntent } = detectIntentAndGeneratePanels(
    chatRequest.question,
  );

  if (shouldUseShortcutResponse(chatRequest.question, panels)) {
    const response: ChatResponse = {
      reply: buildShortcutReply(panels),
      metadata: buildShortcutMetadata(Date.now() - pipelineStartedAt),
      panels: [...panels, ...suggestionPanelsForShortcut()],
    };
    return jsonResponse(response);
  }

  const history = stripEchoedQuestion(
    chatRequest.history,
    chatRequest.question,
  );
  const { embedding, retrieval } = await prepareRag(
    env,
    chatRequest.question,
    history,
  );

  if (retrieval.documents.length === 0) {
    const metadata: ChatMetadata = {
      embedding_stats: embedding,
      retrieval_stats: [],
      generation_stats: emptyGenerationStats(),
      confidence_score: 0,
      total_time_ms: Date.now() - pipelineStartedAt,
      retrieval_time_ms: retrieval.timeMs,
    };
    return jsonResponse({
      reply: "I don't have any information to answer that question.",
      metadata,
      panels,
    } satisfies ChatResponse);
  }

  const messages = buildGenerationMessages(
    chatRequest.question,
    retrieval.documents,
    hasContactIntent,
    history,
  );
  const completion = await createCompletion(env.OPENAI_API_KEY, messages);
  const metadata: ChatMetadata = {
    embedding_stats: embedding,
    retrieval_stats: retrieval.matches,
    generation_stats: completion.stats,
    confidence_score: confidenceScore(retrieval.matches),
    total_time_ms: Date.now() - pipelineStartedAt,
    retrieval_time_ms: retrieval.timeMs,
  };
  return jsonResponse({
    reply: completion.reply,
    metadata,
    panels: [...panels, ...generateFollowUpSuggestions(retrieval.matches)],
  } satisfies ChatResponse);
}

async function handleChatStream(request: Request, env: Env) {
  const body = await request.json();
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const pipelineStartedAt = Date.now();
        const send = (value: unknown) => controller.enqueue(encoder.encode(sse(value)));

        try {
          const chatRequest = parseChatRequest(body);
          const { panels, hasContactIntent } = detectIntentAndGeneratePanels(
            chatRequest.question,
          );

          if (shouldUseShortcutResponse(chatRequest.question, panels)) {
            const reply = buildShortcutReply(panels);
            send({ type: "token", text: reply });
            send({
              type: "done",
              reply,
              metadata: buildShortcutMetadata(Date.now() - pipelineStartedAt),
              panels: [...panels, ...suggestionPanelsForShortcut()],
            });
            return;
          }

          const history = stripEchoedQuestion(
            chatRequest.history,
            chatRequest.question,
          );
          send({ type: "embedding" });
          const { embedding, retrieval } = await prepareRag(
            env,
            chatRequest.question,
            history,
          );
          send({
            type: "retrieval",
            matches: retrieval.matches,
            time_ms: retrieval.timeMs,
          });

          if (retrieval.documents.length === 0) {
            const reply =
              "I don't have any information to answer that question.";
            send({ type: "token", text: reply });
            send({
              type: "done",
              reply,
              metadata: {
                embedding_stats: embedding,
                retrieval_stats: [],
                generation_stats: emptyGenerationStats(),
                confidence_score: 0,
                total_time_ms: Date.now() - pipelineStartedAt,
                retrieval_time_ms: retrieval.timeMs,
              },
              panels,
            });
            return;
          }

          const messages = buildGenerationMessages(
            chatRequest.question,
            retrieval.documents,
            hasContactIntent,
            history,
          );
          const generationStartedAt = Date.now();
          const openAIStream = await createCompletionStream(
            env.OPENAI_API_KEY,
            messages,
          );
          const reader = openAIStream.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let reply = "";
          let usage:
            | {
                total_tokens?: number;
                prompt_tokens?: number;
                completion_tokens?: number;
              }
            | undefined;

          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let event: {
                choices?: Array<{ delta?: { content?: string | null } }>;
                usage?: typeof usage;
              };
              try {
                event = JSON.parse(data) as typeof event;
              } catch {
                continue;
              }
              const text = event.choices?.[0]?.delta?.content;
              if (text) {
                reply += text;
                send({ type: "token", text });
              }
              if (event.usage) usage = event.usage;
            }
          }

          if (!reply) {
            reply =
              "Sorry, I couldn't generate a response just now - could you rephrase that?";
            send({ type: "token", text: reply });
          }

          const generationStats: GenerationStats = {
            tokens: usage?.total_tokens ?? 0,
            time_ms: Date.now() - generationStartedAt,
            model: GENERATION_MODEL,
            prompt_tokens: usage?.prompt_tokens ?? 0,
            completion_tokens: usage?.completion_tokens ?? 0,
          };
          const metadata: ChatMetadata = {
            embedding_stats: embedding,
            retrieval_stats: retrieval.matches,
            generation_stats: generationStats,
            confidence_score: confidenceScore(retrieval.matches),
            total_time_ms: Date.now() - pipelineStartedAt,
            retrieval_time_ms: retrieval.timeMs,
          };
          send({
            type: "done",
            reply,
            metadata,
            panels: [
              ...panels,
              ...generateFollowUpSuggestions(retrieval.matches),
            ],
          });
        } catch (error) {
          console.error("Chat stream failed", error);
          send({
            type: "error",
            detail: "An error occurred while processing your request",
          });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        ...corsHeaders(),
      },
    },
  );
}

async function enforceRateLimit(request: Request, env: Env) {
  const key = request.headers.get("cf-connecting-ip") || "unknown";
  return env.CHAT_RATE_LIMITER.limit({ key });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return jsonResponse({
          status: "ok",
          message: "NicoBot API is running",
          runtime: "cloudflare-workers",
          vector_store: "cloudflare-vectorize",
        });
      }

      if (request.method === "GET" && url.pathname === "/warmup") {
        const startedAt = Date.now();
        await env.VECTORIZE.queryById("summary_1", {
          topK: 1,
          returnMetadata: "none",
        });
        return jsonResponse({
          status: "ok",
          message: "No warm-up required",
          runtime: "cloudflare-workers",
          vector_store: "cloudflare-vectorize",
          vectorize_query_time_ms: Date.now() - startedAt,
        });
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/chat" || url.pathname === "/chat/stream")
      ) {
        const limit = await enforceRateLimit(request, env);
        if (!limit.success) {
          return jsonResponse({ detail: "Rate limit exceeded" }, 429);
        }
        return url.pathname === "/chat"
          ? await handleChat(request, env)
          : await handleChatStream(request, env);
      }

      return jsonResponse({ detail: "Not found" }, 404);
    } catch (error) {
      console.error("Request failed", error);
      const status =
        error instanceof SyntaxError ||
        (error instanceof Error &&
          [
            "Question",
            "Request body",
          ].some((prefix) => error.message.startsWith(prefix)))
          ? 400
          : 500;
      return jsonResponse(
        {
          detail:
            status === 400
              ? errorMessage(error)
              : "An error occurred while processing your request",
        },
        status,
      );
    }
  },
} satisfies ExportedHandler<Env>;
