export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type OpenAIMessage = {
  role: "system" | ChatRole;
  content: string;
};

export type ChatRequest = {
  question: string;
  history: ChatMessage[];
};

export type Panel = {
  type:
    | "linkedin"
    | "github"
    | "email"
    | "project"
    | "resume"
    | "link"
    | "suggestion";
  title: string;
  subtitle?: string;
  url?: string;
  icon?: string;
  action?: string;
  is_question?: boolean;
};

export type EmbeddingStats = {
  dimension: number;
  norm: number;
  active_dimensions: number;
  sample_values: number[];
  time_ms: number;
  model: string;
  sparsity: number;
};

export type RetrievalMatch = {
  score: number;
  doc_id: string;
  snippet: string;
};

export type GenerationStats = {
  tokens: number;
  time_ms: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
};

export type ChatMetadata = {
  embedding_stats: EmbeddingStats;
  retrieval_stats: RetrievalMatch[];
  generation_stats: GenerationStats;
  confidence_score: number;
  total_time_ms: number;
  retrieval_time_ms: number;
};

export type ChatResponse = {
  reply: string;
  metadata: ChatMetadata;
  panels: Panel[];
};
