import './SuggestedQuestions.css';

interface CategoryState {
  category: string;
  currentIndex: number;
  questions: string[];
}

interface SuggestedQuestionsProps {
  onQuestionClick: (question: string, categoryIndex: number) => void;
  categoryStates: CategoryState[];
  disabled?: boolean;
}

export default function SuggestedQuestions({ onQuestionClick, categoryStates, disabled }: SuggestedQuestionsProps) {
  return (
    <div className="suggested-questions">
      <div className="questions-grid">
        {categoryStates.map((categoryState, index) => {
          const currentQuestion = categoryState.questions[categoryState.currentIndex];
          return (
            <button
              key={categoryState.category}
              onClick={() => onQuestionClick(currentQuestion, index)}
              className="question-button"
              data-category={categoryState.category}
              disabled={disabled}
            >
              {currentQuestion}
            </button>
          );
        })}
      </div>
    </div>
  );
}