"""Unit tests for the NicoBot backend logic (no network calls)."""
import json

import pytest
from pydantic import ValidationError

import main
from main import (
    ChatMessage, ChatRequest, build_retrieval_query, strip_echoed_question,
    build_generation_messages, _generation_kwargs, generate_response, stream_generation,
    detect_intent_and_generate_panels, should_use_shortcut_response,
    generate_follow_up_suggestions, RetrievalMatch, SYSTEM_PROMPT, _sse,
)


# --- request validation -----------------------------------------------------

def test_chatmessage_rejects_bad_role():
    with pytest.raises(ValidationError):
        ChatMessage(role="system", content="x")


def test_chatmessage_accepts_valid_roles():
    assert ChatMessage(role="user", content="hi").role == "user"
    assert ChatMessage(role="assistant", content="hi").role == "assistant"


def test_chatmessage_truncates_long_content():
    assert len(ChatMessage(role="assistant", content="x" * 12000).content) == 8000


def test_chatmessage_strips_control_chars():
    assert ChatMessage(role="user", content="he\x00llo\x07").content == "hello"


def test_history_capped_to_12():
    req = ChatRequest(question="hi", history=[ChatMessage(role="user", content=str(i)) for i in range(15)])
    assert len(req.history) == 12 and req.history[0].content == "3"


def test_question_rejects_empty():
    with pytest.raises(ValidationError):
        ChatRequest(question="   ")


def test_question_rejects_script_injection():
    with pytest.raises(ValidationError):
        ChatRequest(question="<script>alert(1)</script>")


# --- retrieval query + dedupe ----------------------------------------------

def test_build_retrieval_query_no_history():
    assert build_retrieval_query("Where is he based?", []) == "Where is he based?"


def test_build_retrieval_query_uses_recent_user_turns():
    hist = [ChatMessage(role="user", content="Does he know React?"),
            ChatMessage(role="assistant", content="Yes.")]
    q = build_retrieval_query("how did he apply it", hist)
    assert "React" in q and "how did he apply it" in q


def test_strip_echoed_question_drops_trailing_dupe():
    q = "Tell me about NicoBot"
    hist = [ChatMessage(role="user", content="hi"), ChatMessage(role="user", content=q)]
    assert len(strip_echoed_question(hist, q)) == 1


def test_strip_echoed_question_keeps_normal_history():
    hist = [ChatMessage(role="user", content="hi"), ChatMessage(role="assistant", content="hello")]
    assert len(strip_echoed_question(hist, "Tell me about NicoBot")) == 2


# --- intent + shortcut ------------------------------------------------------

@pytest.mark.parametrize("q,expected_type", [
    ("what's his email?", "email"),
    ("does he have linkedin?", "linkedin"),
    ("show me his github", "github"),
    ("can I see his resume?", "resume"),
])
def test_detect_intent(q, expected_type):
    panels, contact = detect_intent_and_generate_panels(q)
    assert contact is True and any(p.type == expected_type for p in panels)


def test_shortcut_for_plain_contact():
    panels, _ = detect_intent_and_generate_panels("what's his email?")
    assert should_use_shortcut_response("what's his email?", panels) is True


def test_no_shortcut_for_rag_question():
    q = "tell me about his experience with React"
    panels, _ = detect_intent_and_generate_panels(q)
    assert should_use_shortcut_response(q, panels) is False


# --- suggestions ------------------------------------------------------------

def test_follow_up_suggestions_clean_and_three():
    matches = [RetrievalMatch(score=0.5, doc_id="project_nicobot", snippet="x"),
               RetrievalMatch(score=0.5, doc_id="experience_anser_qa", snippet="y")]
    sugg = [p.title.lower() for p in generate_follow_up_suggestions("q", "a", matches)]
    assert len(sugg) == 3
    banned = ["jetter", "qa-pipeline", "kafka", "graduate", "hobb", "leadership"]
    assert not any(b in s for s in sugg for b in banned)


# --- generation -------------------------------------------------------------

def test_generation_kwargs_are_gpt5_safe():
    kw = _generation_kwargs([{"role": "user", "content": "x"}])
    assert kw["model"] == "gpt-5.4-mini"
    assert kw["max_completion_tokens"] == 2048
    assert "temperature" not in kw and "max_tokens" not in kw
    assert kw["extra_body"]["reasoning_effort"] == "low"


def test_generation_messages_order():
    hist = [ChatMessage(role="user", content="q1"), ChatMessage(role="assistant", content="a1")]
    msgs = build_generation_messages("q2", ["ctx"], False, hist)
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert "ctx" in msgs[-1]["content"] and "q2" in msgs[-1]["content"]


def test_guardrail_in_prompt():
    assert "REPRESENTING NICO" in SYSTEM_PROMPT and "weakness" in SYSTEM_PROMPT.lower()


class _Delta:
    def __init__(self, c):
        self.content = c


class _Choice:
    def __init__(self, c):
        self.delta = _Delta(c)
        self.message = _Delta(c)


class _Usage:
    prompt_tokens = 11
    completion_tokens = 7
    total_tokens = 18


class _Resp:
    def __init__(self, choices, usage=None):
        self.choices = choices
        self.usage = usage


def test_generate_response_uses_model_and_usage(monkeypatch):
    captured = {}

    def fake_create(**kwargs):
        captured.update(kwargs)
        return _Resp([_Choice("Hello there.")], _Usage())

    monkeypatch.setattr(main.openai_client.chat.completions, "create", fake_create)
    reply, stats = generate_response("hi", ["ctx"], False, [])
    assert reply == "Hello there."
    assert stats.model == "gpt-5.4-mini" and stats.tokens == 18
    assert "temperature" not in captured and "max_tokens" not in captured


def test_stream_generation_yields_tokens_and_stats(monkeypatch):
    def fake_create(**kwargs):
        assert kwargs.get("stream") is True
        assert kwargs.get("stream_options") == {"include_usage": True}
        return iter([
            _Resp([_Choice("Nico ")]),
            _Resp([_Choice("uses ")]),
            _Resp([_Choice("React.")]),
            _Resp([], _Usage()),  # final usage-only chunk
        ])

    monkeypatch.setattr(main.openai_client.chat.completions, "create", fake_create)
    events = list(stream_generation("q", ["ctx"], False, []))
    tokens = "".join(e["text"] for e in events if e["type"] == "token")
    done = [e for e in events if e["type"] == "generation_done"][0]
    assert tokens == "Nico uses React."
    assert done["reply"] == "Nico uses React."
    assert done["stats"].tokens == 18 and done["stats"].prompt_tokens == 11


def test_stream_generation_empty_falls_back(monkeypatch):
    def fake_create(**kwargs):
        return iter([_Resp([], _Usage())])  # no content at all

    monkeypatch.setattr(main.openai_client.chat.completions, "create", fake_create)
    events = list(stream_generation("q", ["ctx"], False, []))
    done = [e for e in events if e["type"] == "generation_done"][0]
    assert "couldn't generate" in done["reply"]


def test_sse_format():
    frame = _sse({"type": "token", "text": "hi"})
    assert frame.startswith("data: ") and frame.endswith("\n\n")
    assert json.loads(frame[6:].strip())["text"] == "hi"
