import type { GenerationStats, OpenAIMessage } from "./contracts";
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  GENERATION_MAX_COMPLETION_TOKENS,
  GENERATION_MODEL,
  GENERATION_REASONING_EFFORT,
} from "./portfolio";

const OPENAI_API_URL = "https://api.openai.com/v1";

type OpenAIErrorBody = {
  error?: {
    message?: string;
  };
};

async function openAIError(response: Response) {
  let message = `OpenAI request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as OpenAIErrorBody;
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the status-based error when the response is not JSON.
  }
  return new Error(message);
}

export async function createEmbedding(apiKey: string, input: string) {
  const response = await fetch(`${OPENAI_API_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [input],
      dimensions: EMBEDDING_DIMENSION,
      encoding_format: "float",
    }),
  });
  if (!response.ok) throw await openAIError(response);
  const body = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = body.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error("OpenAI returned an invalid embedding");
  }
  return embedding;
}

function completionBody(messages: OpenAIMessage[]) {
  return {
    model: GENERATION_MODEL,
    messages,
    max_completion_tokens: GENERATION_MAX_COMPLETION_TOKENS,
    reasoning_effort: GENERATION_REASONING_EFFORT,
  };
}

export async function createCompletion(
  apiKey: string,
  messages: OpenAIMessage[],
) {
  const startedAt = Date.now();
  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(completionBody(messages)),
  });
  if (!response.ok) throw await openAIError(response);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: {
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  const reply =
    body.choices?.[0]?.message?.content ||
    "Sorry, I couldn't generate a response just now - could you rephrase that?";
  const stats: GenerationStats = {
    tokens: body.usage?.total_tokens ?? 0,
    time_ms: Date.now() - startedAt,
    model: GENERATION_MODEL,
    prompt_tokens: body.usage?.prompt_tokens ?? 0,
    completion_tokens: body.usage?.completion_tokens ?? 0,
  };
  return { reply, stats };
}

export async function createCompletionStream(
  apiKey: string,
  messages: OpenAIMessage[],
) {
  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...completionBody(messages),
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!response.ok) throw await openAIError(response);
  if (!response.body) throw new Error("OpenAI returned an empty stream");
  return response.body;
}
