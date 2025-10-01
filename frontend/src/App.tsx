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
  };
  retrieval_stats: Array<{
    score: number;
    doc_id: string;
  }>;
  generation_stats: {
    tokens: number;
    time_ms: number;
  };
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
        <NeuralNetworkViz
          isProcessing={isProcessing}
          metadata={metadata}
          processingStage={processingStage}
        />
      </div>
      <div className="right-panel">
        <ChatBox
          ref={chatBoxRef}
          onMetadataUpdate={handleMetadataUpdate}
          onStageUpdate={handleStageUpdate}
        />
        <SuggestedQuestions onQuestionClick={handleQuestionSelect} />
      </div>
    </div>
  )
}

export default App
