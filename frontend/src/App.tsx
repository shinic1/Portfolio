import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ChatBox from './components/ChatBox'
import SuggestedQuestions from './components/SuggestedQuestions'
import NeuralNetworkViz from './components/NeuralNetworkViz'
import './App.css'

interface CategoryState {
  category: string;
  currentIndex: number;
  questions: string[];
}

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

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
let hasWarmedBackend = false

function App() {
  const chatBoxRef = useRef<{
    sendMessage: (question: string) => void;
    isLoading: boolean;
    latestMetadata?: NetworkMetadata;
  }>(null)
  const [metadata, setMetadata] = useState<NetworkMetadata | undefined>()
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStage, setProcessingStage] = useState<'embedding' | 'retrieval' | 'generation' | 'idle'>('idle')
  const [geekMode, setGeekMode] = useState(false)
  const [showQuickLinks, setShowQuickLinks] = useState(false)
  const [categoryStates, setCategoryStates] = useState<CategoryState[]>([
    {
      category: 'experience',
      currentIndex: 0,
      questions: [
        "Tell me about his work",
        "What's his current role?",
        "What has he worked on?",
        "Tell me about his internships",
        "What technologies does he use?"
      ]
    },
    {
      category: 'skills',
      currentIndex: 0,
      questions: [
        "What are his skills?",
        "Does he know React?",
        "What languages does he know?",
        "What's his strongest skill?",
        "What frameworks can he use?"
      ]
    },
    {
      category: 'education',
      currentIndex: 0,
      questions: [
        "Where does he study?",
        "What's he studying?",
        "When does he graduate?",
        "What's his major?",
        "Tell me about his education"
      ]
    }
  ])

  useEffect(() => {
    if (hasWarmedBackend) return
    hasWarmedBackend = true

    void fetch(`${API_BASE_URL}/`, {
      method: 'GET',
      cache: 'no-store',
    }).catch((error) => {
      console.warn('Backend warm-up failed:', error)
    })
  }, [])

  const handleQuestionSelect = (question: string, categoryIndex: number) => {
    // Prevent clicking while a request is in progress
    if (isProcessing) return

    chatBoxRef.current?.sendMessage(question)
    setIsProcessing(true)
    setProcessingStage('embedding')

    // Update only the clicked category's index
    setCategoryStates(prev =>
      prev.map((cat, idx) =>
        idx === categoryIndex
          ? { ...cat, currentIndex: (cat.currentIndex + 1) % cat.questions.length }
          : cat  // Other categories stay unchanged
      )
    )
  }

  const handleMetadataUpdate = (newMetadata: NetworkMetadata) => {
    setMetadata(newMetadata)
    setIsProcessing(false)
    setProcessingStage('idle')
  }

  const handleStageUpdate = (stage: 'embedding' | 'retrieval' | 'generation') => {
    setIsProcessing(true)
    setProcessingStage(stage)
  }

  return (
    <div className="app-container">
      <div className="left-panel">
        <button
          className={`quick-links-toggle ${showQuickLinks ? 'active' : ''}`}
          onClick={() => setShowQuickLinks(!showQuickLinks)}
          title="Quick Links"
        >
          <svg className="toggle-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {showQuickLinks && (
          <div className="quick-links-panel">
            <div className="quick-links-header">Quick Links</div>
            <div className="quick-links-list">
              <a
                href="https://www.linkedin.com/in/nico-bourel-09237a216/"
                target="_blank"
                rel="noopener noreferrer"
                className="quick-link-item"
              >
                <svg className="link-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                <span>LinkedIn</span>
              </a>
              <a
                href="https://github.com/shinic1"
                target="_blank"
                rel="noopener noreferrer"
                className="quick-link-item"
              >
                <svg className="link-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span>GitHub</span>
              </a>
              <Link
                to="/resume"
                className="quick-link-item"
              >
                <svg className="link-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16 13H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16 17H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Resume</span>
              </Link>
              <a
                href="mailto:nico.bourel@swedev.online"
                className="quick-link-item"
              >
                <svg className="link-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 6l-10 7L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Email</span>
              </a>
            </div>
          </div>
        )}
        <button
          className={`geek-mode-toggle ${geekMode ? 'active' : ''}`}
          onClick={() => setGeekMode(!geekMode)}
          title={geekMode ? "Disable Advanced Mode" : "Enable Advanced Mode"}
        >
          <svg className="toggle-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <NeuralNetworkViz
          isProcessing={isProcessing}
          metadata={metadata}
          processingStage={processingStage}
          geekMode={geekMode}
        />
      </div>
      <div className="right-panel">
        <ChatBox
          ref={chatBoxRef}
          onMetadataUpdate={handleMetadataUpdate}
          onStageUpdate={handleStageUpdate}
          geekMode={geekMode}
        />
        <SuggestedQuestions onQuestionClick={handleQuestionSelect} categoryStates={categoryStates} disabled={isProcessing} />
      </div>
    </div>
  )
}

export default App
