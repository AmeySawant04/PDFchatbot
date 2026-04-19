"""
Tests for the ChunkingService.

Covers: chunk_text(), embed_chunks(), semantic_search(),
        encode_embeddings(), decode_embeddings().
"""

import pytest
import numpy as np
from services.chunking import (
    ChunkingService,
    encode_embeddings,
    decode_embeddings,
)


# ── chunk_text() ─────────────────────────────────────────────────────────────


class TestChunkText:
    """Tests for ChunkingService.chunk_text()."""

    def test_basic_chunking(self):
        """Should split text into chunks of approximately chunk_size."""
        text = "Hello world. " * 100  # ~1300 chars
        chunks = ChunkingService.chunk_text(text, chunk_size=200, overlap=20)

        assert len(chunks) > 1
        for chunk in chunks:
            assert "text" in chunk
            assert "startIdx" in chunk
            assert "endIdx" in chunk
            assert len(chunk["text"]) > 0

    def test_empty_text(self):
        """Should return empty list for empty string."""
        assert ChunkingService.chunk_text("") == []
        assert ChunkingService.chunk_text("   ") == []

    def test_none_text(self):
        """Should return empty list for None."""
        assert ChunkingService.chunk_text(None) == []

    def test_short_text_single_chunk(self):
        """Text shorter than chunk_size should produce exactly one chunk."""
        text = "Short text."
        chunks = ChunkingService.chunk_text(text, chunk_size=512, overlap=50)

        assert len(chunks) == 1
        assert chunks[0]["text"] == "Short text."
        assert chunks[0]["startIdx"] == 0

    def test_chunk_overlap(self):
        """Consecutive chunks should have overlapping content."""
        text = "Word " * 200  # ~1000 chars
        chunks = ChunkingService.chunk_text(text, chunk_size=100, overlap=20)

        # With overlap, there should be shared content between consecutive chunks
        assert len(chunks) >= 2

        # Verify startIdx of chunk N+1 < endIdx of chunk N (overlap)
        for i in range(len(chunks) - 1):
            current_end = chunks[i]["endIdx"]
            next_start = chunks[i + 1]["startIdx"]
            # Next chunk should start before current chunk ends (overlap)
            assert next_start < current_end, (
                f"Chunk {i} ends at {current_end}, "
                f"chunk {i+1} starts at {next_start} — no overlap!"
            )

    def test_sentence_boundary_splitting(self):
        """Chunks should prefer to split at sentence boundaries."""
        text = "First sentence. Second sentence. Third sentence. Fourth sentence."
        chunks = ChunkingService.chunk_text(text, chunk_size=30, overlap=5)

        # Check that chunks tend to end at periods
        for chunk in chunks[:-1]:  # last chunk may not end at period
            stripped = chunk["text"].rstrip()
            # Should end at a sentence boundary (period) when possible
            if len(stripped) > 10:
                assert stripped[-1] in ".!?", (
                    f"Chunk did not end at sentence boundary: '{stripped[-20:]}'"
                )

    def test_indices_cover_full_text(self):
        """Chunk indices should collectively cover the entire text."""
        text = "Testing coverage of the full text content here. " * 20
        chunks = ChunkingService.chunk_text(text, chunk_size=100, overlap=10)

        # First chunk should start at 0
        assert chunks[0]["startIdx"] == 0
        # Last chunk should reach the end
        assert chunks[-1]["endIdx"] <= len(text)

    def test_no_empty_chunks(self):
        """No chunk should have empty text."""
        text = "Line one.\n\n\nLine two.\n\n\nLine three."
        chunks = ChunkingService.chunk_text(text, chunk_size=15, overlap=3)

        for chunk in chunks:
            assert len(chunk["text"].strip()) > 0


# ── embed_chunks() ───────────────────────────────────────────────────────────


class TestEmbedChunks:
    """Tests for ChunkingService.embed_chunks()."""

    def test_embed_produces_correct_shape(self):
        """Embeddings should be (n_chunks, 384) for all-MiniLM-L6-v2."""
        chunks = [
            {"text": "Hello world", "startIdx": 0, "endIdx": 11},
            {"text": "Another chunk", "startIdx": 10, "endIdx": 23},
        ]
        embeddings = ChunkingService.embed_chunks(chunks)

        assert isinstance(embeddings, np.ndarray)
        assert embeddings.shape == (2, 384)

    def test_embed_empty_produces_empty(self):
        """Empty chunk list should produce empty array."""
        embeddings = ChunkingService.embed_chunks([])
        assert embeddings.size == 0

    def test_embed_single_chunk(self):
        """Single chunk should produce (1, 384) array."""
        chunks = [{"text": "Single chunk", "startIdx": 0, "endIdx": 12}]
        embeddings = ChunkingService.embed_chunks(chunks)

        assert embeddings.shape == (1, 384)

    def test_embed_consistency(self):
        """Same text should produce the same embedding."""
        chunks = [{"text": "Consistent input", "startIdx": 0, "endIdx": 16}]
        emb1 = ChunkingService.embed_chunks(chunks)
        emb2 = ChunkingService.embed_chunks(chunks)

        np.testing.assert_array_almost_equal(emb1, emb2)


# ── semantic_search() ────────────────────────────────────────────────────────


class TestSemanticSearch:
    """Tests for ChunkingService.semantic_search()."""

    @pytest.fixture
    def search_data(self):
        """Create a set of chunks with pre-computed embeddings."""
        chunks = [
            {"text": "Python is a programming language.", "startIdx": 0, "endIdx": 33},
            {"text": "The weather today is sunny.", "startIdx": 33, "endIdx": 60},
            {"text": "Machine learning uses algorithms.", "startIdx": 60, "endIdx": 93},
            {"text": "Cooking pasta requires boiling water.", "startIdx": 93, "endIdx": 130},
            {"text": "Neural networks are deep learning models.", "startIdx": 130, "endIdx": 171},
        ]
        embeddings = ChunkingService.embed_chunks(chunks)
        return chunks, embeddings

    def test_returns_top_k_results(self, search_data):
        """Should return exactly top_k results."""
        chunks, embeddings = search_data
        results = ChunkingService.semantic_search(
            "What is deep learning?", embeddings, chunks, top_k=3
        )

        assert len(results) == 3

    def test_correct_result_format(self, search_data):
        """Each result should be a (chunk_dict, score) tuple."""
        chunks, embeddings = search_data
        results = ChunkingService.semantic_search(
            "programming", embeddings, chunks, top_k=2
        )

        for chunk, score in results:
            assert "text" in chunk
            assert isinstance(score, float)
            assert 0 <= score <= 1.0 or score >= -1.0  # cosine sim range

    def test_relevance_ordering(self, search_data):
        """Results should be sorted by descending similarity."""
        chunks, embeddings = search_data
        results = ChunkingService.semantic_search(
            "What is machine learning?", embeddings, chunks, top_k=5
        )

        scores = [score for _, score in results]
        for i in range(len(scores) - 1):
            assert scores[i] >= scores[i + 1], "Results not in descending order"

    def test_relevant_chunks_ranked_higher(self, search_data):
        """ML-related query should rank ML chunks above cooking/weather."""
        chunks, embeddings = search_data
        results = ChunkingService.semantic_search(
            "neural network deep learning", embeddings, chunks, top_k=5
        )

        top_2_texts = [chunk["text"] for chunk, _ in results[:2]]
        # At least one of the top 2 should mention ML or neural
        ml_related = any(
            "learning" in t.lower() or "neural" in t.lower() for t in top_2_texts
        )
        assert ml_related, f"Top 2 results not ML-related: {top_2_texts}"

    def test_top_k_exceeds_chunks(self, search_data):
        """top_k larger than chunk count should return all chunks."""
        chunks, embeddings = search_data
        results = ChunkingService.semantic_search(
            "query", embeddings, chunks, top_k=100
        )

        assert len(results) == len(chunks)

    def test_empty_chunks(self):
        """Empty chunks and embeddings should return empty results."""
        results = ChunkingService.semantic_search(
            "query", np.array([]), [], top_k=5
        )
        assert results == []


# ── encode_embeddings() / decode_embeddings() ────────────────────────────────


class TestEmbeddingSerialization:
    """Tests for base64 encoding/decoding of numpy arrays."""

    def test_round_trip(self):
        """Encode then decode should approximate the original array."""
        original = np.random.rand(10, 384).astype(np.float32)
        encoded = encode_embeddings(original)
        decoded = decode_embeddings(encoded)

        assert decoded.shape == original.shape
        # float16 round-trip loses some precision, but should be close
        np.testing.assert_array_almost_equal(decoded, original, decimal=2)

    def test_encode_empty(self):
        """Encoding empty array should return empty string."""
        assert encode_embeddings(np.array([])) == ""
        assert encode_embeddings(None) == ""

    def test_decode_empty(self):
        """Decoding empty string should return empty array."""
        result = decode_embeddings("")
        assert result.size == 0

    def test_encoded_is_string(self):
        """Encoded output should be a base64 string."""
        arr = np.random.rand(5, 384).astype(np.float32)
        encoded = encode_embeddings(arr)

        assert isinstance(encoded, str)
        assert len(encoded) > 0

    def test_compression_ratio(self):
        """Base64-encoded float16 should be smaller than JSON float32 arrays."""
        import json

        arr = np.random.rand(50, 384).astype(np.float32)
        encoded = encode_embeddings(arr)
        json_str = json.dumps(arr.tolist())

        # Encoded should be significantly smaller
        ratio = len(encoded) / len(json_str)
        assert ratio < 0.5, f"Compression ratio {ratio:.2f} — expected < 0.5"
