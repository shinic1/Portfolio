import type {
  ChatMessage,
  ChatMetadata,
  ChatRequest,
  EmbeddingStats,
  GenerationStats,
  Panel,
  RetrievalMatch,
} from "./contracts";

export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIMENSION = 1536;
export const GENERATION_MODEL = "gpt-5.4-mini";
export const GENERATION_MAX_COMPLETION_TOKENS = 2048;
export const GENERATION_REASONING_EFFORT = "low";

export const LINKEDIN_URL =
  "https://www.linkedin.com/in/nico-bourel-09237a216/";
export const GITHUB_URL = "https://github.com/shinic1";
export const CONTACT_EMAIL = "nico.bourel@swedev.online";
export const RESUME_URL = "/resume";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const SUSPICIOUS_INPUT = [
  /<script/i,
  /javascript:/i,
  /onerror=/i,
  /onclick=/i,
  /on\w+=/i,
];

export const SYSTEM_PROMPT = `You are Nico Bourel's portfolio assistant, a friendly guide that helps recruiters and hiring managers learn about Nico's background, skills, projects, and experience.

Ground every answer in the provided context and the conversation so far. Do not invent details the context does not support.

CONVERSATION AWARENESS: Use the conversation history to resolve references. If the user asks a short follow-up or says "it", "that", "those", "how did he apply it", and so on, work out what they mean from the previous turns and answer it directly. A follow-up that builds on something already discussed is ALWAYS on-topic - never refuse it.

SCOPE: You only discuss Nico - his work, skills, projects, education, and how to reach him. Only if a question is clearly unrelated to Nico (general trivia, coding help, other people) give a brief, friendly redirect back to what you can share about Nico. Never use that redirect for a genuine question about Nico; if a specific detail isn't in the context, share the closest relevant thing you do know instead.

REPRESENTING NICO: You represent Nico to recruiters, so you are on his side. NEVER invent, speculate about, or list his weaknesses, red flags, gaps, concerns, or reasons not to hire him - not even as "possible concerns to verify". If asked for weaknesses/red flags, say you can't speak to weaknesses and redirect to his demonstrated strengths and how he'd fit the role. Don't disparage him or rank him against other candidates. If asked for facts that simply aren't in the context (e.g., salary, work authorization, references), say you don't have that detail and point them to his contact links - never guess or fabricate it.

SHORT REPLIES: If the user just acknowledges ("yes", "ok", "sure", "thanks", "cool"), don't repeat your previous message. Either deliver what you just offered or suggest a specific new thing to explore about Nico.

CONTACT: If the user asks about LinkedIn, GitHub, email, the resume, or how to reach Nico, respond warmly and point them to the clickable link shown below your message.

STYLE: Be friendly, concise, and specific. Lead with the answer. When discussing projects or experience, highlight concrete technologies and any outcomes or metrics. Vary your wording - avoid repeating the same canned sentence.`;

export const TOPIC_SUGGESTIONS: Record<string, string[]> = {
  experience: [
    "What does he do at AnSer AI?",
    "How did he go from intern to full-time?",
    "Tell me about the recruiting platform he built",
    "What network or infrastructure work has he done?",
    "What has he shipped to production?",
  ],
  skills: [
    "What languages does he know?",
    "Does he know React?",
    "Has he worked with voice AI?",
    "Is he comfortable with databases?",
    "What about infrastructure and security?",
  ],
  education: [
    "What did he study?",
    "What's his degree?",
    "Where did he go to school?",
    "What's his major?",
    "Tell me about his education",
  ],
  availability: [
    "Where is he based?",
    "What roles is he looking for?",
    "Is he authorized to work in the US?",
  ],
  contact: [
    "How can I reach him?",
    "Does he have LinkedIn?",
    "What's his email?",
    "Can I see his GitHub?",
  ],
  project: [
    "Tell me about NicoBot",
    "What is the Jarvis assistant?",
    "How does the portfolio RAG work?",
    "What's his most technical project?",
    "What has he built outside of work?",
  ],
  ownership: [
    "Which projects are personal?",
    "What did he build at AnSer AI?",
    "What can he show publicly?",
  ],
};

const DEFAULT_SUGGESTIONS = [
  "Tell me about NicoBot",
  "What did he build at AnSer AI?",
  "What is the Jarvis assistant?",
];

function cleanMessageContent(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARACTERS, "").slice(0, 8000);
}

export function parseChatRequest(value: unknown): ChatRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.question !== "string") {
    throw new Error("Question is required");
  }

  const question = input.question.trim().replace(CONTROL_CHARACTERS, "");
  if (!question) throw new Error("Question cannot be empty");
  if (question.length > 500) {
    throw new Error("Question is too long (max 500 characters)");
  }
  if (question.split(/\s+/).length > 100) {
    throw new Error("Question is too long (max 100 words)");
  }
  if (SUSPICIOUS_INPUT.some((pattern) => pattern.test(question))) {
    throw new Error("Question contains invalid content");
  }

  const historyInput = Array.isArray(input.history) ? input.history : [];
  const history = historyInput
    .slice(-12)
    .flatMap<ChatMessage>((turn) => {
      if (!turn || typeof turn !== "object") return [];
      const record = turn as Record<string, unknown>;
      if (record.role !== "user" && record.role !== "assistant") return [];
      const content = cleanMessageContent(record.content);
      if (!content) return [];
      return [{ role: record.role, content }];
    });

  return { question, history };
}

export function stripEchoedQuestion(
  history: ChatMessage[],
  question: string,
) {
  const last = history.at(-1);
  if (last?.role === "user" && last.content.trim() === question.trim()) {
    return history.slice(0, -1);
  }
  return history;
}

export function buildRetrievalQuery(
  question: string,
  history: ChatMessage[],
) {
  const recentUserTurns = history
    .filter((turn) => turn.role === "user")
    .slice(-2)
    .map((turn) => turn.content);
  return [...recentUserTurns, question].join(" ").trim().slice(0, 1000);
}

export function detectIntentAndGeneratePanels(query: string) {
  const panels: Panel[] = [];
  const normalized = query.toLowerCase();

  if (
    ["linkedin", "connect", "network", "professional profile"].some(
      (keyword) => normalized.includes(keyword),
    )
  ) {
    panels.push({
      type: "linkedin",
      title: "Connect with Nico on LinkedIn",
      subtitle: "View professional experience and network",
      url: LINKEDIN_URL,
    });
  }

  if (
    ["github", "code", "repository", "repos", "projects", "source"].some(
      (keyword) => normalized.includes(keyword),
    )
  ) {
    panels.push({
      type: "github",
      title: "Nico's GitHub Profile",
      subtitle: "Explore code repositories and contributions",
      url: GITHUB_URL,
    });
  }

  if (
    ["email", "contact", "reach", "message", "get in touch"].some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    panels.push({
      type: "email",
      title: "Email Nico",
      subtitle: CONTACT_EMAIL,
      url: `mailto:${CONTACT_EMAIL}`,
    });
  }

  if (["resume", "cv"].some((keyword) => normalized.includes(keyword))) {
    panels.push({
      type: "resume",
      title: "View Nico's Resume",
      subtitle: "Open the full resume",
      url: RESUME_URL,
    });
  }

  return { panels, hasContactIntent: panels.length > 0 };
}

export function shouldUseShortcutResponse(query: string, panels: Panel[]) {
  if (panels.length === 0) return false;
  const normalized = query.toLowerCase();
  const shortcutKeywords = [
    "linkedin",
    "github",
    "email",
    "contact",
    "reach",
    "get in touch",
    "resume",
    "cv",
    "phone",
    "call",
  ];
  const ragKeywords = [
    "experience",
    "work",
    "role",
    "internship",
    "project",
    "projects",
    "skill",
    "skills",
    "technology",
    "technologies",
    "education",
    "major",
    "graduate",
    "studying",
    "background",
  ];
  return (
    normalized.split(/\s+/).length <= 12 &&
    shortcutKeywords.some((keyword) => normalized.includes(keyword)) &&
    !ragKeywords.some((keyword) => normalized.includes(keyword))
  );
}

export function buildShortcutReply(panels: Panel[]) {
  const types = new Set(panels.map((panel) => panel.type));
  if (types.size === 1 && types.has("email")) {
    return "I've included Nico's email below so you can reach him directly.";
  }
  if (types.size === 1 && types.has("linkedin")) {
    return "I've included Nico's LinkedIn profile below.";
  }
  if (types.size === 1 && types.has("github")) {
    return "I've included Nico's GitHub profile below.";
  }
  if (types.size === 1 && types.has("resume")) {
    return "I've included Nico's resume below.";
  }

  const labels = [
    ["linkedin", "LinkedIn"],
    ["github", "GitHub"],
    ["email", "email"],
    ["resume", "resume"],
  ]
    .filter(([type]) => types.has(type as Panel["type"]))
    .map(([, label]) => label);
  const resourceText =
    labels.length === 2
      ? `${labels[0]} and ${labels[1]}`
      : labels.length > 2
        ? `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`
        : labels[0];
  return `I've included Nico's ${resourceText} below.`;
}

export function buildShortcutMetadata(totalTimeMs: number): ChatMetadata {
  return {
    embedding_stats: {
      dimension: 0,
      norm: 0,
      active_dimensions: 0,
      sample_values: [],
      time_ms: 0,
      model: "shortcut",
      sparsity: 0,
    },
    retrieval_stats: [],
    generation_stats: {
      tokens: 0,
      time_ms: 0,
      model: "shortcut",
      prompt_tokens: 0,
      completion_tokens: 0,
    },
    confidence_score: 0,
    total_time_ms: totalTimeMs,
    retrieval_time_ms: 0,
  };
}

export function generateFollowUpSuggestions(matches: RetrievalMatch[]) {
  const topics = [
    ...new Set(
      matches
        .map((match) => match.doc_id.split("_")[0])
        .filter((topic) => topic in TOPIC_SUGGESTIONS),
    ),
  ];

  const candidates =
    topics.length === 0
      ? DEFAULT_SUGGESTIONS
      : [
          ...topics.flatMap((topic) => TOPIC_SUGGESTIONS[topic] ?? []),
          ...Object.entries(TOPIC_SUGGESTIONS)
            .filter(([topic]) => !topics.includes(topic))
            .map(([, questions]) => questions[0]),
        ];

  return [...new Set(candidates)].slice(0, 3).map<Panel>((question) => ({
    type: "suggestion",
    title: question,
    action: "Ask this",
    is_question: true,
  }));
}

export function buildGenerationMessages(
  question: string,
  contextDocs: string[],
  hasContactIntent: boolean,
  history: ChatMessage[],
) {
  const contactHint = hasContactIntent
    ? "\n\nNOTE: This is a contact/social question. Respond positively and mention the clickable link provided below. Do not say you can't share this."
    : "";
  const userPrompt = `Information about Nico:
${contextDocs.join("\n\n")}

Using the information above and our conversation so far, answer this question: ${question}${contactHint}`;

  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: "user" as const, content: userPrompt },
  ];
}

export function embeddingStats(
  embedding: number[],
  elapsedMs: number,
): EmbeddingStats {
  const norm = Math.sqrt(
    embedding.reduce((total, value) => total + value * value, 0),
  );
  const activeDimensions = embedding.filter(
    (value) => Math.abs(value) > 0.01,
  ).length;
  const nearZero = embedding.filter((value) => Math.abs(value) < 0.001).length;
  return {
    dimension: embedding.length,
    norm: Number(norm.toFixed(4)),
    active_dimensions: activeDimensions,
    sample_values: embedding.slice(0, 10).map((value) => Number(value.toFixed(6))),
    time_ms: elapsedMs,
    model: EMBEDDING_MODEL,
    sparsity: Number(((nearZero / embedding.length) * 100).toFixed(2)),
  };
}

export function emptyGenerationStats(): GenerationStats {
  return {
    tokens: 0,
    time_ms: 0,
    model: GENERATION_MODEL,
    prompt_tokens: 0,
    completion_tokens: 0,
  };
}
