import './SuggestedQuestions.css';

interface SuggestedQuestionsProps {
  onQuestionClick: (question: string) => void;
  questions?: string[]; // Optional dynamic questions
}

export default function SuggestedQuestions({ onQuestionClick, questions }: SuggestedQuestionsProps) {
  const defaultQuestions = [
    "What projects has Nico done?",
    "Tell me about Nico's skills.",
    "Where is Nico studying?"
  ];

  // Use provided questions if available, otherwise use defaults
  const displayQuestions = questions && questions.length > 0 ? questions : defaultQuestions;

  return (
    <div className="suggested-questions">
      <div className="questions-grid">
        {displayQuestions.map((question, index) => (
          <button
            key={index}
            onClick={() => onQuestionClick(question)}
            className="question-button"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}