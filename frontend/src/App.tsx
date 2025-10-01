import { useRef, useState } from 'react'
import ChatBox from './components/ChatBox'
import SuggestedQuestions from './components/SuggestedQuestions'
import NeuralNetworkViz from './components/NeuralNetworkViz'
import './App.css'

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

  const handleQuestionSelect = (question: string) => {
    chatBoxRef.current?.sendMessage(question)
    setIsProcessing(true)
    setProcessingStage('embedding')
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
          className={`geek-mode-toggle ${geekMode ? 'active' : ''}`}
          onClick={() => setGeekMode(!geekMode)}
          title={geekMode ? "Disable Geek Mode" : "Enable Geek Mode"}
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
        <SuggestedQuestions onQuestionClick={handleQuestionSelect} />
      </div>
    </div>
  )
}

export default App
