import './MessagePanel.css';

export type PanelType = 'linkedin' | 'github' | 'email' | 'project' | 'resume' | 'link' | 'suggestion';

export interface Panel {
  type: PanelType;
  title: string;
  subtitle?: string;
  url?: string;
  icon?: string;
  action?: string; // Text for action button, e.g., "View Profile", "Open Project"
  is_question?: boolean; // True for clickable question suggestions
}

interface MessagePanelProps {
  panel: Panel;
  onQuestionClick?: (question: string) => void; // Callback for clicking question suggestions
}

const MessagePanel = ({ panel, onQuestionClick }: MessagePanelProps) => {
  const handleClick = () => {
    // For question suggestions, call the question click handler
    if (panel.is_question && onQuestionClick) {
      onQuestionClick(panel.title);
    }
    // For link panels, open the URL
    else if (panel.url) {
      window.open(panel.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Get default icon based on panel type
  const getIcon = () => {
    if (panel.icon) return panel.icon;

    switch (panel.type) {
      case 'linkedin':
        return '💼';
      case 'github':
        return '⚡';
      case 'email':
        return '📧';
      case 'project':
        return '🚀';
      case 'resume':
        return '📄';
      case 'suggestion':
        return '💬';
      default:
        return '🔗';
    }
  };

  const getActionText = () => {
    if (panel.action) return panel.action;

    switch (panel.type) {
      case 'linkedin':
        return 'View Profile';
      case 'github':
        return 'View GitHub';
      case 'email':
        return 'Send Email';
      case 'project':
        return 'Open Project';
      case 'resume':
        return 'Download';
      case 'suggestion':
        return 'Ask this';
      default:
        return 'Open Link';
    }
  };

  return (
    <div className="message-panel" onClick={handleClick}>
      <div className="panel-content">
        <div className="panel-icon">{getIcon()}</div>
        <div className="panel-text">
          <div className="panel-title">{panel.title}</div>
          {panel.subtitle && <div className="panel-subtitle">{panel.subtitle}</div>}
        </div>
      </div>
      <div className="panel-action">
        <span className="action-text">{getActionText()}</span>
        <span className="action-arrow">→</span>
      </div>
    </div>
  );
};

export default MessagePanel;
