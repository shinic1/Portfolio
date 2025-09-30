"""
Utility script to upload portfolio data to Pinecone.
Run this script to create embeddings and upload them to Pinecone index.
"""
import json
import os
from openai import OpenAI
from pinecone import Pinecone, ServerlessSpec
from dotenv import load_dotenv

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env"))

# Initialize clients
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

INDEX_NAME = "nicobot-portfolio"
DIMENSION = 1536  # text-embedding-3-small dimension

def generate_embeddings(texts):
    """Generate embeddings using OpenAI's text-embedding-3-small model."""
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [item.embedding for item in response.data]

def main():
    print("Loading portfolio data from portfolio_docs.json...")

    # Load portfolio documents
    with open("portfolio_docs.json", "r") as f:
        docs = json.load(f)

    print(f"Found {len(docs)} documents")

    # Check if index exists, create if not
    existing_indexes = [index.name for index in pc.list_indexes()]

    if INDEX_NAME not in existing_indexes:
        print(f"Creating new Pinecone index: {INDEX_NAME}")
        pc.create_index(
            name=INDEX_NAME,
            dimension=DIMENSION,
            metric="cosine",
            spec=ServerlessSpec(
                cloud="aws",
                region="us-east-1"
            )
        )
        print(f"✓ Index '{INDEX_NAME}' created successfully")
    else:
        print(f"✓ Index '{INDEX_NAME}' already exists")

    # Connect to index
    index = pc.Index(INDEX_NAME)

    print(f"\nGenerating embeddings for {len(docs)} documents...")

    # Generate embeddings
    texts = [doc["content"] for doc in docs]
    embeddings = generate_embeddings(texts)

    print("Uploading vectors to Pinecone...")

    # Prepare vectors for upload
    vectors_to_upsert = []
    for i, doc in enumerate(docs):
        vectors_to_upsert.append({
            "id": doc["id"],
            "values": embeddings[i],
            "metadata": {
                "content": doc["content"]
            }
        })

    # Upsert vectors to Pinecone
    index.upsert(vectors=vectors_to_upsert)

    print(f"\n✓ Successfully uploaded {len(docs)} vectors to Pinecone!")
    print(f"  - Index name: {INDEX_NAME}")
    print(f"  - Dimension: {DIMENSION}")
    print(f"  - Metric: cosine")

    # Get index stats
    stats = index.describe_index_stats()
    print(f"  - Total vectors in index: {stats.total_vector_count}")

if __name__ == "__main__":
    main()