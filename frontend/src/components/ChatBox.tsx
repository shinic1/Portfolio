import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
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
}

export interface ChatBoxRef {
  sendMessage: (question: string) => void;
  isLoading: boolean;
  latestMetadata?: NetworkMetadata;
}

interface ChatBoxProps {
  onMetadataUpdate?: (metadata: NetworkMetadata) => void;
  onStageUpdate?: (stage: 'embedding' | 'retrieval' | 'generation') => void;
  onSuggestionsUpdate?: (suggestions: string[]) => void;
  geekMode?: boolean;
}

const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(({ onMetadataUpdate, onStageUpdate, onSuggestionsUpdate }, ref) => {
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

    const userMessage: Message = { role: 'user', content: question };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Stage 1: Embedding (starts immediately)
      onStageUpdate?.('embedding');

      // Simulate stage progression based on typical timing
      setTimeout(() => onStageUpdate?.('retrieval'), 300);
      setTimeout(() => onStageUpdate?.('generation'), 800);

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response from server');
      }

      const data = await response.json();
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.reply,
        metadata: data.metadata,
        panels: data.panels || []
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Update metadata for visualization
      if (data.metadata) {
        setLatestMetadata(data.metadata);
        onMetadataUpdate?.(data.metadata);
      }

      // Extract and update suggestions
      if (data.panels && onSuggestionsUpdate) {
        const suggestionPanels = data.panels.filter((p: Panel) => p.type === 'suggestion' && p.is_question);
        if (suggestionPanels.length > 0) {
          const newSuggestions = suggestionPanels.map((p: Panel) => p.title);
          onSuggestionsUpdate(newSuggestions);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please make sure the backend server is running.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
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
        {messages.length === 0 && (
          <div className="welcome-message">
            <div className="welcome-icon">🤖</div>
            <h2>Hey there! I'm NicoBot</h2>
            <p>Your AI guide to Nico's portfolio. Ask me anything about his projects, skills, experience, or education!</p>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-wrapper">
              <div className="message-content">
                {message.content}
              </div>
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

        {isLoading && (
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
          placeholder="Ask me anything about Nico..."
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