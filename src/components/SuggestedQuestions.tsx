import './SuggestedQuestions.css';

interface SuggestedQuestionsProps {
  onQuestionClick: (question: string) => void;
}

export default function SuggestedQuestions({ onQuestionClick }: SuggestedQuestionsProps) {
  const questions = [
    "What projects has Nico done?",
    "Tell me about Nico's skills.",
    "Where is Nico studying?"
  ];

  return (
    <div className="suggested-questions">
      <p className="suggested-label">Suggested questions:</p>
      <div className="questions-grid">
        {questions.map((question, index) => (
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