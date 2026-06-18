"""Pytest setup.

Provides dummy API keys so the OpenAI/Pinecone clients can be constructed at import
time (construction makes no network calls), and ensures the backend dir is importable.
The suite never makes real network calls - generation is monkeypatched and the
embed/retrieve paths are not exercised.
"""
import os
import sys

os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("PINECONE_API_KEY", "pc-test")
sys.path.insert(0, os.path.dirname(__file__))
