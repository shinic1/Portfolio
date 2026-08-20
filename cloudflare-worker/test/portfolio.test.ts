import { describe, expect, it } from "vitest";

import {
  buildGenerationMessages,
  buildRetrievalQuery,
  detectIntentAndGeneratePanels,
  embeddingStats,
  generateFollowUpSuggestions,
  parseChatRequest,
  shouldUseShortcutResponse,
  stripEchoedQuestion,
  SYSTEM_PROMPT,
} from "../src/portfolio";

describe("portfolio request validation", () => {
  it("cleans and caps conversation history", () => {
    const request = parseChatRequest({
      question: "  Does he know React?  ",
      history: Array.from({ length: 15 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `turn\u0000-${index}`,
      })),
    });
    expect(request.question).toBe("Does he know React?");
    expect(request.history).toHaveLength(12);
    expect(request.history[0].content).not.toContain("\u0000");
  });

  it("rejects empty and suspicious questions", () => {
    expect(() => parseChatRequest({ question: "   " })).toThrow(
      "Question cannot be empty",
    );
    expect(() =>
      parseChatRequest({ question: "<script>alert(1)</script>" }),
    ).toThrow("Question contains invalid content");
  });
});
describe("retrieval and generation context", () => {
  it("uses recent user turns for follow-up retrieval", () => {
    const history = [
      { role: "user" as const, content: "Does he know React?" },
      { role: "assistant" as const, content: "Yes." },
    ];
    expect(buildRetrievalQuery("How did he apply it?", history)).toContain(
      "React",
    );
  });

  it("drops a trailing echoed question", () => {
    const question = "Tell me about NicoBot";
    expect(
      stripEchoedQuestion([{ role: "user", content: question }], question),
    ).toEqual([]);
  });

  it("keeps the grounding guardrails and message order", () => {
    const messages = buildGenerationMessages(
      "What did he build?",
      ["Verified context"],
      false,
      [
        { role: "user", content: "Tell me about Nico" },
        { role: "assistant", content: "Sure." },
      ],
    );
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages.at(-1)?.content).toContain("Verified context");
    expect(SYSTEM_PROMPT).toContain("REPRESENTING NICO");
  });
});

describe("portfolio response helpers", () => {
  it("uses deterministic shortcuts for direct contact requests", () => {
    const intent = detectIntentAndGeneratePanels("What's his email?");
    expect(intent.panels.some((panel) => panel.type === "email")).toBe(true);
    expect(
      shouldUseShortcutResponse("What's his email?", intent.panels),
    ).toBe(true);
  });

  it("generates three clean follow-up questions", () => {
    const panels = generateFollowUpSuggestions([
      { score: 0.9, doc_id: "project_nicobot", snippet: "NicoBot" },
      { score: 0.8, doc_id: "experience_anser_qa", snippet: "AnSer" },
    ]);
    expect(panels).toHaveLength(3);
    expect(panels.every((panel) => panel.type === "suggestion")).toBe(true);
  });

  it("computes embedding telemetry", () => {
    const stats = embeddingStats([0, 0.02, -0.03], 12);
    expect(stats.dimension).toBe(3);
    expect(stats.active_dimensions).toBe(2);
    expect(stats.time_ms).toBe(12);
  });
});
