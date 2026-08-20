import './FeaturedWork.css'

interface FeaturedWorkProps {
  onSelect: (question: string) => void;
  disabled?: boolean;
}

const featuredWork = [
  {
    title: 'Applicant tracking system',
    detail: 'LiveKit screening, Twilio messaging, Cal.com scheduling, and self-hosted deployment.',
    question: 'Tell me about the production applicant tracking system Nico built. What did he own, what is the stack, and how do hiring managers use it?',
  },
  {
    title: 'LLM call evaluation',
    detail: '26 scoring workflows used to evaluate agent performance and call quality.',
    question: 'Tell me about Nico’s work on the 26 LLM call-evaluation workflows. What did the system evaluate, what did he contribute, and why did it matter?',
  },
  {
    title: 'Voice AI integrations',
    detail: 'Vapi, ElevenLabs, LiveKit, Twilio, and human-in-the-loop routing.',
    question: 'Tell me about Nico’s customer-facing voice AI work, including the demos, integrations, and human-in-the-loop routing he built.',
  },
]

export default function FeaturedWork({ onSelect, disabled = false }: FeaturedWorkProps) {
  return (
    <div className="featured-work" aria-label="Featured work">
      <div className="featured-work-heading">
        <h2>Featured work</h2>
        <p>Select a project to ask NicoBot for the details.</p>
      </div>

      <div className="featured-work-list">
        {featuredWork.map(item => (
          <button
            className="featured-work-panel"
            type="button"
            key={item.title}
            onClick={() => onSelect(item.question)}
            disabled={disabled}
          >
            <span className="featured-work-copy">
              <strong>{item.title}</strong>
              <span className="featured-work-detail">{item.detail}</span>
            </span>
            <span className="featured-work-action">Ask about this <span aria-hidden="true">→</span></span>
          </button>
        ))}
      </div>

      <p className="featured-work-footnote">You can also type your own question below.</p>
    </div>
  )
}
