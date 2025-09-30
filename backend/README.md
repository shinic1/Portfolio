# Portfolio Backend

FastAPI backend with OpenAI and Pinecone integration.

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment variables in `.env`:
```
OPENAI_API_KEY=your_key_here
PINECONE_API_KEY=your_key_here
```

## Development

```bash
uvicorn main:app --reload
```

## Deploy

Deploy to any Python hosting service (Render, Railway, Fly.io, etc.) with the following command:
```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```
