import os
from flask import Flask, request, jsonify
from flask_cors import CORS

import pdfplumber
import numpy as np
from PIL import Image
import traceback
import requests, time
import json
import sys
from dotenv import load_dotenv
import traceback

# Import chunking service
from services.chunking import ChunkingService, encode_embeddings, decode_embeddings

load_dotenv()  # Add this near the top of your file

sys.stdout.reconfigure(encoding='utf-8') #make output on console error free (mostly)

# ── Lazy-loaded OCR reader (English only, CPU mode) ─────────────────────────
_ocr_reader = None

def _get_ocr_reader():
    """Lazy-load the EasyOCR reader to avoid import-time overhead (~5s first run)."""
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr
        print("[OCR] Loading EasyOCR reader (English)...")
        _ocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        print("[OCR] EasyOCR reader loaded successfully")
    return _ocr_reader


app = Flask(__name__)
CORS(app)


# API URLs and Keys
DEEPSEEK_API_URL = "https://openrouter.ai/api/v1/chat/completions"
HF_API_URL = "https://api-inference.huggingface.co/models/meta-llama/Llama-3.1-405B"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")  
HUGGINGFACE_API_KEY = os.getenv("HUGGINGFACE_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")


# Note: pdf_data is now returned from extract_pdf_info() rather than
# stored as global mutable state (which caused concurrency bugs).

def determine_pdf_title(metadata, text, original_filename=""):
    # 1. Check metadata title
    title = metadata.get("Title", "").strip()
    if title and title.lower() != "unknown":
        return title

    # 2. Fallback: use the first non-empty line of actual PDF content
    for line in text.splitlines():
        clean_line = line.strip()
        if clean_line and len(clean_line) > 3:
            return clean_line[:80]

    # 3. Fallback: use the uploaded filename (strip extension)
    if original_filename:
        name = os.path.splitext(original_filename)[0]
        # Clean up underscores/hyphens into spaces, title-case
        name = name.replace('_', ' ').replace('-', ' ').strip()
        if name:
            return name[:80]

    return "Untitled PDF"

def extract_pdf_info(pdf_path, original_filename=""):
    """Extract text, metadata, and OCR content from a PDF file.
    Returns a new dict each call (no global state)."""
    print("[Python] Pdf Path:", pdf_path)
    pdf_data = {
        "text": "",
        "meta_info": {
            "Title": "Unknown",
            "Author": "Unknown",
            "Pages": 0
        }
    }

    try:
        with pdfplumber.open(pdf_path) as pdf:
            metadata = pdf.metadata or {}
            text = "\n".join([page.extract_text() or "" for page in pdf.pages])
            page_count = len(pdf.pages)

            # ── OCR: extract text from images in each page ───────────────
            ocr_texts = []
            for page_num, page in enumerate(pdf.pages):
                images = page.images
                if not images:
                    continue

                try:
                    # Render page to PIL image at 200 DPI
                    page_image = page.to_image(resolution=200).original

                    for img_info in images:
                        try:
                            # Crop the image region using bounding box
                            bbox = (
                                img_info['x0'],
                                img_info['top'],
                                img_info['x1'],
                                img_info['bottom']
                            )
                            cropped = page_image.crop(bbox)

                            # Skip very small images (likely decorative)
                            if cropped.width < 50 or cropped.height < 50:
                                continue

                            # Run OCR on the cropped image
                            reader = _get_ocr_reader()
                            results = reader.readtext(
                                np.array(cropped),
                                detail=0,
                                paragraph=True
                            )

                            if results:
                                ocr_text = ' '.join(results)
                                ocr_texts.append(ocr_text)
                        except Exception as img_err:
                            print(f"[OCR] Skipping image on page {page_num + 1}: {img_err}")
                            continue

                except Exception as page_err:
                    print(f"[OCR] Skipping page {page_num + 1} images: {page_err}")
                    continue

            if ocr_texts:
                print(f"[OCR] Extracted text from {len(ocr_texts)} images")
                combined_ocr = "\n\n".join(ocr_texts)
                # Determine title BEFORE appending OCR (use text-layer content)
                text_for_title = text
                text = text + "\n\n" + combined_ocr
            else:
                print("[OCR] No images with extractable text found")
                text_for_title = text

        pdf_data["text"] = text
        pdf_data["meta_info"]["Title"] = determine_pdf_title(metadata, text_for_title, original_filename)
        pdf_data["meta_info"]["Author"] = metadata.get("Author", "Unknown")
        pdf_data["meta_info"]["Pages"] = page_count

        print(f"[Python] Extracted PDF: {pdf_data['meta_info']['Title']} ({page_count} pages)")

    except FileNotFoundError:
        print("[ERROR] PDF file not found.")
        raise
    except Exception as e:
        print(f"[ERROR] Failed to extract PDF info: {e}")
        raise

    return pdf_data

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for load balancers and monitoring."""
    return jsonify({"status": "ok", "service": "pdf-chat-python"})


@app.route('/process', methods=['POST'])
def process_pdf():
    try:
        data = request.json
        pdf_path = data.get('pdf_path')
        original_filename = data.get('original_filename', '')

        print(f"[INFO] PDF path received: {pdf_path}")
        if original_filename:
            print(f"[INFO] Original filename: {original_filename}")

        if not pdf_path or not os.path.exists(pdf_path):
            return jsonify({"status": "error", "message": "Invalid or missing PDF path"}), 400

        pdf_data = extract_pdf_info(pdf_path, original_filename)

        # ── Chunk and embed the extracted text ───────────────────────────
        chunker = ChunkingService()
        raw_text = pdf_data["text"]
        
        chunks = chunker.chunk_text(raw_text, chunk_size=512, overlap=50)
        print(f"[Python] Text chunked into {len(chunks)} chunks")

        embeddings = chunker.embed_chunks(chunks)
        encoded_embeddings = encode_embeddings(embeddings)
        print(f"[Python] Embeddings generated, encoded size: {len(encoded_embeddings)} chars")

        # Add chunks and embeddings to pdf_data for Node.js to store
        pdf_data["chunks"] = chunks
        pdf_data["embeddings"] = encoded_embeddings

        return jsonify({
            "status": "success", 
            "message": "PDF processed successfully.", 
            "pdf_data": pdf_data
        })

    except Exception as e:
        print("[ERROR] Exception in /process route:")
        traceback.print_exc()
        return jsonify({"status": "error", "message": "Internal server error"}), 500


@app.route('/chunk-text', methods=['POST'])
def chunk_text_endpoint():
    """Chunk and embed pre-extracted text (for guest session migration).
    Accepts raw text, returns chunks + encoded embeddings."""
    try:
        data = request.json
        text = data.get('text', '')

        if not text or not text.strip():
            return jsonify({"status": "error", "message": "No text provided"}), 400

        print(f"[Python] /chunk-text called, text length: {len(text)} chars")

        chunker = ChunkingService()
        chunks = chunker.chunk_text(text, chunk_size=512, overlap=50)
        print(f"[Python] Text chunked into {len(chunks)} chunks")

        embeddings = chunker.embed_chunks(chunks)
        encoded = encode_embeddings(embeddings)
        print(f"[Python] Embeddings generated, encoded size: {len(encoded)} chars")

        return jsonify({
            "status": "success",
            "chunks": chunks,
            "embeddings": encoded
        })

    except Exception as e:
        print("[ERROR] Exception in /chunk-text route:")
        traceback.print_exc()
        return jsonify({"status": "error", "message": "Internal server error"}), 500



@app.route('/ask', methods=['POST'])
def ask_question():
    try:
        question = request.json.get("question")
        print(f"[INFO] Question: {question}")

        groq_response = query_multiple_groq(question)

        return jsonify({"answer": groq_response})

    except Exception as e:
        print("[ERROR] Exception in /ask route:")
        traceback.print_exc()
        
        return jsonify({"answer": "Sorry, there was an error processing your question."}), 500

@app.route('/ask-target', methods=['POST'])
def ask_question_target():
    print("\n[Python] /ask-target route called")
    data = request.json
    question = data['question']
    pdf_data = data['pdfData']
    chat_history = data.get('chatHistory', '')
    token_limits = data.get('tokenLimits', {})

    print("[Python] Question:", question)
    print("[Python] PDF title:", pdf_data['meta_info']['Title'])
    print("[Python] Chat history length:", len(chat_history))
    print("[Python] Token limits:", token_limits)

    try:
        # ── Semantic search path (new chunked format) ────────────────────
        chunks = pdf_data.get('chunks', [])
        embeddings_str = pdf_data.get('embeddings', '')

        if chunks and embeddings_str:
            print(f"[Python] Using semantic search ({len(chunks)} chunks)")
            chunker = ChunkingService()
            
            # Decode stored embeddings
            chunk_embeddings = decode_embeddings(embeddings_str)
            
            # Find most relevant chunks
            results = chunker.semantic_search(
                question, chunk_embeddings, chunks, top_k=5
            )
            
            # Build focused context from top chunks (clean, no debug labels)
            relevant_text = "\n\n".join([
                chunk['text']
                for chunk, score in results
            ])
            
            print(f"[Python] Semantic search returned {len(results)} chunks")
            print(f"[Python] Relevant context length: {len(relevant_text)} chars (vs full text)")

            context = f"""Document: {pdf_data['meta_info']['Title']}
Author: {pdf_data['meta_info'].get('Author', 'Unknown')}
Pages: {pdf_data['meta_info'].get('Pages', 'Unknown')}

Content:
{relevant_text}

Conversation so far:
{chat_history}

Question: {question}
"""
        else:
            # ── Fallback: full text path (legacy sessions) ───────────────
            full_text = pdf_data.get('text', '')
            print(f"[Python] Using full text fallback ({len(full_text)} chars)")
            
            # Truncate if too long to avoid token limits
            max_text_chars = 30000  # ~7500 tokens
            if len(full_text) > max_text_chars:
                full_text = full_text[:max_text_chars] + "\n\n[... text truncated for token limit ...]"
                print(f"[Python] Text truncated to {max_text_chars} chars")

            context = f"""Document: {pdf_data['meta_info']['Title']}
Author: {pdf_data['meta_info'].get('Author', 'Unknown')}
Pages: {pdf_data['meta_info'].get('Pages', 'Unknown')}

Content:
{full_text}

Conversation so far:
{chat_history}

Question: {question}
"""

        print("[Python] Context constructed, length:", len(context))
        print("[Python] Calling API...")
        
        response = query_multiple_groq(context)

        print("[Python] Got response from API")
        print("[Python] Response length:", len(response))
        
        return jsonify({"answer": response})
    except Exception as e:
        print(f"[Python] Error in ask_question_target: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

def query_deepseek(user_question, token_limits=None):
    try:
        print("[Python] Starting query_deepseek")
        context = user_question
        
        headers = {
            "Authorization": DEEPSEEK_API_KEY,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "PDFChatBot"
        }

        messages = [
            {"role": "system", "content": "You are a helpful PDF assistant."},
            {"role": "user", "content": context}
        ]

        data = {
            "model": "deepseek/deepseek-chat-v3-0324:free",
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": token_limits.get("aiResponse", 2048) if token_limits else 2048
        }

        print("[Python] Preparing DeepSeek API request")
        print("[Python] Token limit:", data["max_tokens"])
        print("[Python] Message lengths:", [len(m["content"]) for m in messages])
        
        response = requests.post(
            DEEPSEEK_API_URL,
            headers=headers,
            json=data,
            timeout=30
        )
        
        print(f"[Python] DeepSeek API Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"[Python] DeepSeek API Error Response: {response.text}")
            return "I apologize, but I'm having trouble processing your request at the moment. Please try again."
            
        response_json = response.json()
        if not response_json.get("choices"):
            print("[Python] No choices in response:", response_json)
            return "I apologize, but I received an invalid response. Please try again."
            
        answer = response_json["choices"][0]["message"]["content"]
        print("[Python] Successfully got answer from DeepSeek")
        print("[Python] Answer length:", len(answer))
        return answer

    except requests.exceptions.Timeout:
        print("[Python] DeepSeek API timeout after 30 seconds")
        return "I apologize, but the request timed out. Please try again."
    except requests.exceptions.RequestException as e:
        print(f"[Python] Network error in query_deepseek: {str(e)}")
        return f"Network error: {str(e)}" 
    except Exception as e:
        print(f"[Python] Unexpected error in query_deepseek: {str(e)}")
        print("[Python] Error traceback:", traceback.format_exc())
        return "I apologize, but an unexpected error occurred. Please try again."


def query_ollama(prompt, model="llama3.1:8b", stream=False):
    """
    Query the local Ollama model running on http://localhost:11434
    """
    try:
        print("[Python] Sending request to Ollama...")
        
        # url = "http://localhost:11434/api/generate"
        url = HF_API_URL
        headers = {"Content-Type": "application/json",
                    "Authorization": f"Bearer {HUGGINGFACE_API_KEY}"
                    }

        payload = {
            "model": model,
            "inputs": prompt,
            "stream": stream  # You can set to True if you want streaming later
        }

        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()

        result = response.json()

        # Hugging Face sometimes returns a list, sometimes a dict
        if isinstance(result, list) and len(result) > 0:
            return result[0].get("generated_text", "")
        elif isinstance(result, dict) and "generated_text" in result:
            return result["generated_text"]
        else:
            return "No valid response from model."

    except requests.exceptions.RequestException as e:
        print(f"[Python] Error communicating with Ollama: {str(e)}")
        return "⚠️ Unable to reach the Ollama server. Make sure it's running with `ollama serve`."

#Llama 3.3 70B Versatile on Groq
def query_groq(prompt, model="llama-3.3-70b-versatile", token_limits=None):
    """
    Query the Groq API using Llama 3.3 70B Versatile model.
    Designed to be easily integrated with /ask and /ask-target routes.
    """
    try:
        print("[Python] Sending request to Groq API...")

        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }

        messages = [
            {"role": "system", "content": "You are a helpful AI assistant specialized in analyzing and summarizing PDF content."},
            {"role": "user", "content": prompt}
        ]

        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": token_limits.get("aiResponse", 2048) if token_limits else 2048
        }

        response = requests.post(GROQ_API_URL, headers=headers, json=payload, timeout=30)
        print(f"[Python] Groq API Status: {response.status_code}")

        if response.status_code != 200:
            print(f"[ERROR] Groq API Error: {response.text}")
            return "⚠️ Groq API failed to respond properly. Please try again later."

        response_json = response.json()
        if "choices" not in response_json or not response_json["choices"]:
            print("[Python] Groq API returned an invalid response:", response_json)
            return "⚠️ Groq API returned an empty response."

        answer = response_json["choices"][0]["message"]["content"]
        print("[Python] Successfully got response from Groq")
        print("[Python] Answer length:", len(answer))
        return answer

    except requests.exceptions.Timeout:
        print("[ERROR] Groq API request timed out.")
        return "⚠️ Groq API timed out. Please try again."
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Network issue communicating with Groq API: {e}")
        return f"⚠️ Network error: {str(e)}"
    except Exception as e:
        print(f"[ERROR] Unexpected error in query_groq: {e}")
        traceback.print_exc()
        return "⚠️ Unexpected error occurred while querying Groq."


# Model priority list (top = primary)
MODEL_FALLBACKS = [
    "llama-3.3-70b-versatile",          # primary
    "meta-llama/llama-4-scout-17b-16e-instruct",  # high-quality backup
    "moonshotai/kimi-k2-instruct-0905", # solid, general-purpose fallback
    "llama-3.1-8b-instant"              # fast, light fallback
]


def query_multiple_groq(prompt, token_limits=None):
    """
    Query Groq API with automatic fallback when rate limit (TPM) is hit.
    If Retry-After ≤ 3s, waits and retries the same model.
    If Retry-After > 3s, switches to next model immediately.
    """
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert PDF assistant. You have full access to the document's content. "
                "Answer questions directly and confidently based on what the document contains. "
                "Rules:\n"
                "- Be direct and assertive. Do NOT say 'the content extracted from the PDF mentions' or similar hedging.\n"
                "- Speak as if you have read the document yourself. Say 'The document explains...' or 'According to this PDF...' or just state the answer directly.\n"
                "- Never expose internal processing details like chunk numbers, relevance scores, OCR labels, or image tags.\n"
                "- If the document contains images with text (e.g., screenshots, diagrams, tables), describe their purpose naturally without mentioning OCR or extraction.\n"
                "- If you are unsure, say so briefly — do not over-hedge with 'likely', 'appears to be', 'seems like' on every sentence.\n"
                "- Use markdown formatting for code blocks, lists, and emphasis when helpful.\n"
                "- Keep responses concise but thorough."
            )
        },
        {"role": "user", "content": prompt}
    ]

    for model in MODEL_FALLBACKS:
        print(f"[Python] Attempting with model: {model}")

        while True:  # inner loop to retry same model if wait time ≤ 3s
            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.3,
                "max_tokens": token_limits.get("aiResponse", 2048) if token_limits else 2048
            }

            try:
                response = requests.post(GROQ_API_URL, headers=headers, json=payload, timeout=30)
                print(f"[Python] Groq API Status ({model}): {response.status_code}")

                # ✅ Successful response
                if response.status_code == 200:
                    response_json = response.json()
                    if "choices" in response_json and response_json["choices"]:
                        answer = response_json["choices"][0]["message"]["content"]
                        print(f"[Python] ✅ Success with {model} (response length {len(answer)})")
                        return answer
                    else:
                        print("[ERROR] Invalid response format:", response_json)
                        return "⚠️ Groq API returned an empty or invalid response."

                # ⚠️ Handle rate limit (429)
                elif response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        wait_time = float(retry_after)
                        print(f"[WARNING] Rate limit hit on {model}. Retry-After: {wait_time}s")

                        if wait_time <= 3:
                            print(f"[Python] Waiting {wait_time}s before retrying {model}...")
                            time.sleep(wait_time)
                            continue  # retry same model
                        else:
                            print(f"[Python] Wait time too long ({wait_time}s). Switching to next model...")
                            break  # go to next model
                    else:
                        print("[Python] No Retry-After header. Switching to next model...")
                        break

                # ⚠️ Handle server errors
                elif 500 <= response.status_code < 600:
                    print(f"[WARNING] Server error on {model}, trying next model...")
                    break

                # ⚠️ Other API errors
                else:
                    print(f"[ERROR] Groq API Error ({model}): {response.text}")
                    break

            except requests.exceptions.Timeout:
                print(f"[ERROR] Timeout on {model}, trying next model...")
                break
            except requests.exceptions.RequestException as e:
                print(f"[ERROR] Network issue with {model}: {e}")
                break
            except Exception as e:
                print(f"[ERROR] Unexpected error with {model}: {e}")
                traceback.print_exc()
                break

    # ❌ If all models fail
    print("[FATAL] ❌ All models failed. Please try again later.")
    return "⚠️ All Groq models are currently busy or unreachable. Please try again later."



if __name__ == '__main__':
    is_debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    port = int(os.getenv('PYTHON_PORT', 5001))
    print(f"[Python] Starting Flask server on port {port} (debug={is_debug})")
    app.run(port=port, debug=is_debug)
    # Production: use gunicorn instead
    # gunicorn -w 4 -b 0.0.0.0:5001 deepseek_server:app
