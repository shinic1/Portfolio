import { useRef } from 'react'
import ChatBox from './components/ChatBox'
import SuggestedQuestions from './components/SuggestedQuestions'
import './App.css'

function App() {
  const chatBoxRef = useRef<{ sendMessage: (question: string) => void }>(null)

  const handleQuestionSelect = (question: string) => {
    chatBoxRef.current?.sendMessage(question)
  }

  return (
    <div className="app-container">
      <ChatBox ref={chatBoxRef} />
      <SuggestedQuestions onQuestionClick={handleQuestionSelect} />
    </div>
  )
}

export default App
