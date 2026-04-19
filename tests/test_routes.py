"""
Tests for Flask API routes in deepseek_server.py.

Covers: /health, /process, /ask, /ask-target endpoints.

Note: External API calls (Groq) are mocked to avoid real API usage.
"""

import os
import sys
import json
import pytest
from unittest.mock import patch, MagicMock

# Ensure project root is on path so imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def client():
    """Create a Flask test client."""
    from deepseek_server import app

    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


# ── /health ──────────────────────────────────────────────────────────────────


class TestHealthEndpoint:
    """Tests for GET /health."""

    def test_health_returns_200(self, client):
        """Health check should return 200 with status ok."""
        res = client.get("/health")
        assert res.status_code == 200

        data = res.get_json()
        assert data["status"] == "ok"
        assert data["service"] == "pdf-chat-python"


# ── /process ─────────────────────────────────────────────────────────────────


class TestProcessEndpoint:
    """Tests for POST /process."""

    def test_missing_pdf_path(self, client):
        """Should return 400 when pdf_path is missing."""
        res = client.post(
            "/process",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert res.status_code == 400

        data = res.get_json()
        assert data["status"] == "error"

    def test_nonexistent_pdf_path(self, client):
        """Should return 400 when pdf_path doesn't exist."""
        res = client.post(
            "/process",
            data=json.dumps({"pdf_path": "/nonexistent/file.pdf"}),
            content_type="application/json",
        )
        assert res.status_code == 400

    @patch("deepseek_server.extract_pdf_info")
    @patch("deepseek_server.ChunkingService")
    @patch("deepseek_server.encode_embeddings")
    def test_valid_pdf_processing(
        self, mock_encode, mock_chunker_class, mock_extract, client, tmp_path
    ):
        """Should process a valid PDF and return chunks + embeddings."""
        import numpy as np

        # Create a temporary file to pass the os.path.exists check
        pdf_file = tmp_path / "test.pdf"
        pdf_file.write_text("fake pdf content")

        # Mock the extraction
        mock_extract.return_value = {
            "text": "Sample extracted text from PDF.",
            "meta_info": {"Title": "Test PDF", "Author": "Tester", "Pages": 2},
        }

        # Mock chunking
        mock_chunker = MagicMock()
        mock_chunker_class.return_value = mock_chunker
        mock_chunker.chunk_text.return_value = [
            {"text": "Sample extracted text", "startIdx": 0, "endIdx": 21},
            {"text": "from PDF.", "startIdx": 18, "endIdx": 30},
        ]
        mock_chunker.embed_chunks.return_value = np.random.rand(2, 384).astype(
            np.float32
        )

        # Mock encoding
        mock_encode.return_value = "base64encodedembeddings=="

        res = client.post(
            "/process",
            data=json.dumps({"pdf_path": str(pdf_file)}),
            content_type="application/json",
        )
        assert res.status_code == 200

        data = res.get_json()
        assert data["status"] == "success"
        assert "pdf_data" in data

        pdf_data = data["pdf_data"]
        assert pdf_data["meta_info"]["Title"] == "Test PDF"
        assert len(pdf_data["chunks"]) == 2
        assert pdf_data["embeddings"] == "base64encodedembeddings=="


# ── /ask ─────────────────────────────────────────────────────────────────────


class TestAskEndpoint:
    """Tests for POST /ask."""

    @patch("deepseek_server.query_multiple_groq")
    def test_ask_returns_answer(self, mock_groq, client):
        """Should return an answer for a valid question."""
        mock_groq.return_value = "This is the AI answer."

        res = client.post(
            "/ask",
            data=json.dumps({"question": "What is Python?"}),
            content_type="application/json",
        )
        assert res.status_code == 200

        data = res.get_json()
        assert data["answer"] == "This is the AI answer."
        mock_groq.assert_called_once()

    @patch("deepseek_server.query_multiple_groq")
    def test_ask_with_empty_question(self, mock_groq, client):
        """Should still process (validation is client-side for /ask)."""
        mock_groq.return_value = "Response to empty."

        res = client.post(
            "/ask",
            data=json.dumps({"question": ""}),
            content_type="application/json",
        )
        # The /ask route doesn't validate question emptiness server-side
        assert res.status_code == 200


# ── /ask-target ──────────────────────────────────────────────────────────────


class TestAskTargetEndpoint:
    """Tests for POST /ask-target."""

    @patch("deepseek_server.query_multiple_groq")
    def test_ask_target_with_chunks(self, mock_groq, client):
        """Should use semantic search when chunks + embeddings are provided."""
        import numpy as np
        from services.chunking import encode_embeddings, ChunkingService

        # Create real embeddings for test chunks
        chunks = [
            {"text": "Python is great.", "startIdx": 0, "endIdx": 16},
            {"text": "Weather is nice.", "startIdx": 16, "endIdx": 32},
        ]
        embeddings = ChunkingService.embed_chunks(chunks)
        encoded = encode_embeddings(embeddings)

        mock_groq.return_value = "Answer based on relevant chunks."

        res = client.post(
            "/ask-target",
            data=json.dumps(
                {
                    "question": "Tell me about Python",
                    "pdfData": {
                        "meta_info": {
                            "Title": "Test",
                            "Author": "Auth",
                            "Pages": 1,
                        },
                        "chunks": chunks,
                        "embeddings": encoded,
                    },
                    "chatHistory": "",
                    "tokenLimits": {"aiResponse": 2048},
                }
            ),
            content_type="application/json",
        )
        assert res.status_code == 200

        data = res.get_json()
        assert data["answer"] == "Answer based on relevant chunks."

    @patch("deepseek_server.query_multiple_groq")
    def test_ask_target_fallback_to_full_text(self, mock_groq, client):
        """Should use full text fallback when no chunks are provided."""
        mock_groq.return_value = "Answer from full text."

        res = client.post(
            "/ask-target",
            data=json.dumps(
                {
                    "question": "What is this about?",
                    "pdfData": {
                        "text": "Full text of the PDF document here.",
                        "meta_info": {
                            "Title": "Legacy",
                            "Author": "Auth",
                            "Pages": 1,
                        },
                    },
                    "chatHistory": "Human: Hi\nAssistant: Hello!",
                    "tokenLimits": {"aiResponse": 1024},
                }
            ),
            content_type="application/json",
        )
        assert res.status_code == 200

        data = res.get_json()
        assert data["answer"] == "Answer from full text."

    @patch("deepseek_server.query_multiple_groq")
    def test_ask_target_truncates_long_text(self, mock_groq, client):
        """Should truncate text longer than 30000 chars in fallback mode."""
        mock_groq.return_value = "Truncated response."

        long_text = "x" * 50000

        res = client.post(
            "/ask-target",
            data=json.dumps(
                {
                    "question": "Summarize",
                    "pdfData": {
                        "text": long_text,
                        "meta_info": {
                            "Title": "Long",
                            "Author": "Auth",
                            "Pages": 100,
                        },
                    },
                    "chatHistory": "",
                }
            ),
            content_type="application/json",
        )
        assert res.status_code == 200

        # Verify the prompt sent to Groq was truncated
        call_args = mock_groq.call_args[0][0]
        assert len(call_args) < 50000
        assert "truncated" in call_args.lower()
