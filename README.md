# Portfolio

Monorepo containing frontend and backend applications for the portfolio website.

## Structure

- `frontend/` - React + TypeScript + Vite frontend application
- `backend/` - FastAPI backend with OpenAI and Pinecone integration

## Development

Each folder has its own README with setup and deployment instructions.

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## Deployment

- Frontend: Deploy to Vercel, Netlify, or any static hosting
- Backend: Deploy to Render, Railway, Fly.io, or any Python hosting service
