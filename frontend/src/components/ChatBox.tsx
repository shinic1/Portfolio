import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ChatBox.css';
import MessagePanel, { type Panel } from './MessagePanel';

interface NetworkMetadata {
  embedding_stats: {
    dimension: number;
    norm: number;
    active_dimensions: number;
    sample_values: number[];
    time_ms: number;
    model: string;
    sparsity: number;
  };
  retrieval_stats: Array<{
    score: number;
    doc_id: string;
    snippet: string;
  }>;
  generation_stats: {
    tokens: number;
    time_ms: number;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
  };
  confidence_score: number;
  total_time_ms: number;
  retrieval_time_ms: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  metadata?: NetworkMetadata;
  panels?: Panel[];
  isError?: boolean;
}

export interface ChatBoxRef {
  sendMessage: (question: string) => void;
  isLoading: boolean;
  latestMetadata?: NetworkMetadata;
}

interface ChatBoxProps {
  onMetadataUpdate?: (metadata: NetworkMetadata) => void;
  onStageUpdate?: (stage: 'embedding' | 'retrieval' | 'generation') => void;
  onProcessingEnd?: () => void;
  geekMode?: boolean;
  isWarmingBackend?: boolean;
}

// One streamed Server-Sent Event from /chat/stream.
type StreamEvent = {
  type: 'embedding' | 'retrieval' | 'token' | 'done' | 'error';
  text?: string;
  reply?: string;
  metadata?: NetworkMetadata;
  panels?: Panel[];
  detail?: string;
};

// Humanize a retrieved doc_id prefix into a recruiter-friendly source label.
const SOURCE_LABELS: Record<string, string> = {
  summary: 'Background',
  availability: 'Availability',
  experience: 'Experience',
  skills: 'Skills',
  project: 'Projects',
  projects: 'Projects',
  ownership: 'Project ownership',
  education: 'Education',
  contact: 'Contact',
};

function sourceLabels(metadata?: NetworkMetadata): string[] {
  if (!metadata?.retrieval_stats?.length) return [];
  const labels: string[] = [];
  for (const match of metadata.retrieval_stats) {
    const prefix = (match.doc_id || '').split('_')[0];
    const label = SOURCE_LABELS[prefix] || 'Profile';
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

// Prefilled "request an intro" email so recruiters can reach Nico in one click.
const INTRO_MAILTO =
  'mailto:nico.bourel@swedev.online' +
  '?subject=' + encodeURIComponent('Reaching out from your AI portfolio') +
  '&body=' + encodeURIComponent('Hi Nico,\n\nI came across your AI portfolio and would love to connect about an opportunity.\n\n');

const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(({ onMetadataUpdate, onStageUpdate, onProcessingEnd, isWarmingBackend = false }, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [latestMetadata, setLatestMetadata] = useState<NetworkMetadata | undefined>();
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (question: string) => {
    if (!question.trim() || isLoading) return;

    // Capture the prior turns (before adding this question) so the backend can
    // resolve follow-ups like "tell me how he applied it". Skip transient error
    // bubbles, send role/content only, and bound length to the backend's limit.
    const history = messages
      .filter(m => !m.isError)
      .slice(-10)
      .map(({ role, content }) => ({ role, content: content.slice(0, 8000) }));

    const userMessage: Message = { role: 'user', content: question };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    onStageUpdate?.('embedding');

    // Progressively fill a single assistant bubble as tokens stream in. The bubble
    // is always the last message while a send is in flight (re-entry is guarded).
    let acc = '';
    let bubbleAdded = false;
    const upsertBubble = (extra: Partial<Message> = {}) => {
      if (!bubbleAdded) {
        bubbleAdded = true;
        setMessages(prev => [...prev, { role: 'assistant', content: acc, ...extra }]);
      } else {
        setMessages(prev =>
          prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: acc, ...extra } : m))
        );
      }
    };

    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000';

    // Fallback for when streaming is unavailable (backend mid-deploy, or an SSE-
    // buffering corporate proxy): fetch the full reply from the non-streaming endpoint.
    const runNonStreaming = async () => {
      const res = await fetch(`${apiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });
      if (!res.ok) throw new Error('Failed to get response from server');
      const data = await res.json();
      acc = data.reply ?? '';
      upsertBubble({ metadata: data.metadata, panels: data.panels || [] });
      if (data.metadata) {
        setLatestMetadata(data.metadata);
        onMetadataUpdate?.(data.metadata);
      }
    };

    try {
      const response = await fetch(`${apiBase}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to get response from server');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamErrored = false;

      // Parse Server-Sent Events frames (each separated by a blank line).
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;

          let payload: StreamEvent;
          try {
            payload = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }

          switch (payload.type) {
            case 'embedding':
              onStageUpdate?.('embedding');
              break;
            case 'retrieval':
              onStageUpdate?.('retrieval');
              break;
            case 'token':
              onStageUpdate?.('generation');
              acc += payload.text ?? '';
              upsertBubble();
              break;
            case 'done':
              acc = payload.reply ?? acc;
              upsertBubble({ metadata: payload.metadata, panels: payload.panels || [] });
              if (payload.metadata) {
                setLatestMetadata(payload.metadata);
                onMetadataUpdate?.(payload.metadata);
              }
              break;
            case 'error':
              streamErrored = true;
              break;
          }
        }
      }

      if (streamErrored) throw new Error('stream error');
    } catch (error) {
      console.error('Streaming failed:', error);
      try {
        // Only safe to retry from scratch if no partial tokens were shown yet.
        if (bubbleAdded) throw error;
        onStageUpdate?.('generation');
        await runNonStreaming();
      } catch (fallbackError) {
        console.error('Error sending message:', fallbackError);
        acc = 'Sorry, I encountered an error. Please make sure the backend server is running.';
        upsertBubble({ isError: true });
      }
    } finally {
      setIsLoading(false);
      onProcessingEnd?.();
    }
  };

  useImperativeHandle(ref, () => ({
    sendMessage,
    isLoading,
    latestMetadata
  }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="chatbox-container">
      <div className="messages-container" ref={messagesContainerRef}>
        {isWarmingBackend && (
          <div className="startup-banner">
            <span className="startup-pulse"></span>
            <div className="startup-copy">
              <strong>Warming up AI search</strong>
              <span>First reply can take a moment while the backend wakes up.</span>
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="welcome-message">
            <div className="welcome-icon">🤖</div>
            <h2>Hey there! I'm Nebula</h2>
            <p>Your AI guide to Nico's portfolio. Ask me anything about his projects, skills, experience, or education!</p>
            <a className="intro-cta" href={INTRO_MAILTO}>
              <span className="intro-cta-icon">📧</span>
              Request an intro
            </a>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-wrapper">
              <div className="message-content">
                {message.role === 'assistant' ? (
                  <div className="message-markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node: _node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  message.content
                )}
              </div>
              {message.role === 'assistant' && !message.isError && sourceLabels(message.metadata).length > 0 && (
                <div className="message-sources">
                  <span className="sources-label">Based on</span>
                  {sourceLabels(message.metadata).map(label => (
                    <span key={label} className="source-chip">{label}</span>
                  ))}
                </div>
              )}
              {message.panels && message.panels.length > 0 && (
                <div className="message-panels">
                  {message.panels
                    .filter(panel => panel.type !== 'suggestion')
                    .map((panel, panelIndex) => (
                      <MessagePanel key={panelIndex} panel={panel} onQuestionClick={sendMessage} />
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content loading">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

      </div>

      <form onSubmit={handleSubmit} className="input-container">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isWarmingBackend ? "AI search is warming up..." : "Ask me anything about Nico..."}
          disabled={isLoading}
          className="chat-input"
        />
        <button type="submit" disabled={isLoading || !input.trim()} className="send-button">
          <span className="send-icon">➤</span>
        </button>
      </form>
    </div>
  );
});

ChatBox.displayName = 'ChatBox';

export default ChatBox;
