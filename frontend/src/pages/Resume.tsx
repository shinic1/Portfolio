import { useNavigate } from 'react-router-dom'
import resumePdf from '../assets/Resume Nico Bourel updated.pdf'
import './Resume.css'

function Resume() {
  const navigate = useNavigate()

  return (
    <div className="resume-container">
      <div className="resume-header">
        <button className="back-button" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Back to Portfolio</span>
        </button>
        <a
          href={resumePdf}
          download="Resume_Nico_Bourel.pdf"
          className="download-button"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Download PDF</span>
        </a>
      </div>
      <div className="resume-viewer">
        <iframe
          src={resumePdf}
          title="Resume - Nico Bourel"
          className="pdf-iframe"
        />
      </div>
    </div>
  )
}

export default Resume
