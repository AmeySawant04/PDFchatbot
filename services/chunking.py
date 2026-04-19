"""
Chunking and Embedding Service for PDF text.

Splits PDF text into overlapping chunks, generates embeddings using
sentence-transformers, and provides semantic search over chunks.
"""

import base64
import io
import numpy as np
from sentence_transformers import SentenceTransformer

# Load model once at module level (lazy singleton)
_model = None

def _get_model():
    """Lazy-load the embedding model to avoid import-time overhead."""
    global _model
    if _model is None:
        print("[Chunking] Loading embedding model: all-MiniLM-L6-v2")
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        print("[Chunking] Model loaded successfully")
    return _model


class ChunkingService:
    """
    Text chunking and semantic search service.
    
    - chunk_text():      Split text into overlapping windows
    - embed_chunks():    Generate embeddings for chunk texts
    - semantic_search(): Find top-K relevant chunks for a query
    """

    @staticmethod
    def chunk_text(text, chunk_size=512, overlap=50):
        """
        Split text into chunks of approximately `chunk_size` characters
        with `overlap` character overlap between consecutive chunks.
        
        Returns:
            list of dicts: [{ "text": str, "startIdx": int, "endIdx": int }]
        """
        if not text or not text.strip():
            return []

        chunks = []
        start = 0
        text_len = len(text)

        while start < text_len:
            end = min(start + chunk_size, text_len)
            
            # Try to break at a sentence or word boundary
            if end < text_len:
                # Look for sentence boundary (., !, ?) within last 20% of chunk
                boundary_search_start = max(start, end - int(chunk_size * 0.2))
                last_period = max(
                    text.rfind(". ", boundary_search_start, end),
                    text.rfind("! ", boundary_search_start, end),
                    text.rfind("? ", boundary_search_start, end),
                    text.rfind(".\n", boundary_search_start, end),
                )
                if last_period > start:
                    end = last_period + 1  # Include the period

                # Fall back to word boundary
                elif text[end] not in (" ", "\n", "\t"):
                    last_space = text.rfind(" ", start, end)
                    if last_space > start:
                        end = last_space

            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append({
                    "text": chunk_text,
                    "startIdx": start,
                    "endIdx": end,
                })

            # Advance with overlap
            start = end - overlap if end < text_len else text_len

        return chunks

    @staticmethod
    def embed_chunks(chunks):
        """
        Generate embeddings for a list of chunk dicts.
        
        Args:
            chunks: list of dicts with 'text' key
            
        Returns:
            numpy array of shape (n_chunks, 384)
        """
        if not chunks:
            return np.array([])

        model = _get_model()
        texts = [c["text"] for c in chunks]
        embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
        return embeddings

    @staticmethod
    def embed_query(query):
        """
        Generate embedding for a single query string.
        
        Returns:
            numpy array of shape (384,)
        """
        model = _get_model()
        return model.encode(query, show_progress_bar=False, convert_to_numpy=True)

    @staticmethod
    def semantic_search(query, chunk_embeddings, chunks, top_k=5):
        """
        Find the top-K most relevant chunks for a given query.
        
        Args:
            query:            The question text
            chunk_embeddings: numpy array (n_chunks, 384)
            chunks:           list of chunk dicts
            top_k:            number of results to return
            
        Returns:
            list of (chunk_dict, score) tuples, sorted by descending similarity
        """
        if len(chunks) == 0 or chunk_embeddings.size == 0:
            return []

        query_embedding = ChunkingService.embed_query(query)

        # Cosine similarity = dot product of normalized vectors
        query_norm = query_embedding / (np.linalg.norm(query_embedding) + 1e-10)
        chunk_norms = chunk_embeddings / (
            np.linalg.norm(chunk_embeddings, axis=1, keepdims=True) + 1e-10
        )
        similarities = np.dot(chunk_norms, query_norm)

        # Get top-K indices
        top_k = min(top_k, len(chunks))
        top_indices = np.argsort(similarities)[::-1][:top_k]

        results = []
        for idx in top_indices:
            results.append((chunks[idx], float(similarities[idx])))

        return results


# ── Serialization helpers for MongoDB storage ────────────────────────────────

def encode_embeddings(embeddings):
    """
    Encode a numpy array as a base64 string for MongoDB storage.
    ~60% smaller than storing as JSON float arrays.
    """
    if embeddings is None or embeddings.size == 0:
        return ""
    
    buf = io.BytesIO()
    np.save(buf, embeddings.astype(np.float16))  # float16 for compression
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def decode_embeddings(encoded_str):
    """
    Decode a base64 string back to a numpy array.
    """
    if not encoded_str:
        return np.array([])
    
    buf = io.BytesIO(base64.b64decode(encoded_str))
    embeddings = np.load(buf).astype(np.float32)  # upcast back to float32
    return embeddings
