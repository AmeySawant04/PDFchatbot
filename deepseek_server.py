import os
from flask import Flask, request, jsonify
from flask_cors import CORS

import pdfplumber
import numpy as np
import traceback
import requests, time
import json
import sys
from dotenv import load_dotenv
import traceback

load_dotenv()  # Add this near the top of your file

sys.stdout.reconfigure(encoding='utf-8') #make output on console error free (mostly)


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

def determine_pdf_title(metadata, text):
    # 1. Check metadata title
    title = metadata.get("Title", "").strip()
    if title and title.lower() != "unknown":
        return title

    # 2. Fallback: use the first non-empty line of actual PDF content
    for line in text.splitlines():
        clean_line = line.strip()
        if clean_line:
            return clean_line[:80]  # optional: limit title length
    return "Untitled PDF"

def extract_pdf_info(pdf_path):
    """Extract text and metadata from a PDF file.
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

        pdf_data["text"] = text
        pdf_data["meta_info"]["Title"] = determine_pdf_title(metadata, text)
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

        print(f"[INFO] PDF path received: {pdf_path}")

        if not pdf_path or not os.path.exists(pdf_path):
            return jsonify({"status": "error", "message": "Invalid or missing PDF path"}), 400

        pdf_data = extract_pdf_info(pdf_path)

        return jsonify({"status": "success", "message": "PDF processed successfully.", "pdf_data": pdf_data})

    except Exception as e:
        print("[ERROR] Exception in /process route:")
        traceback.print_exc()
        return jsonify({"status": "error", "message": "Internal server error"}), 500



@app.route('/ask', methods=['POST'])
def ask_question():
    try:
        question = request.json.get("question")
        print(f"[INFO] Question: {question}")

        # ollama_response = query_ollama(question)

        # groq_response = query_groq(question)

        groq_response = query_multiple_groq(question)

        # deepseek_response = query_deepseek(question)

        # if(deepseek_response.status_code):
        #     if deepseek_response.status_code != 200:
        #         print(f"[ERROR] DeepSeek API failed: {deepseek_response.status_code}", deepseek_response.text)
        #         return jsonify({"answer": "Sorry, DeepSeek API failed to respond properly."}), 500

        # deepseek_answer = deepseek_response.json()["choices"][0]["message"]["content"]

        # return jsonify({"answer": deepseek_answer})

        return jsonify({"answer": groq_response})
    
        # return jsonify({"answer": ollama_response})

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
    print("[Python] PDF content length:", len(pdf_data['text']))
    print("[Python] Chat history length:", len(chat_history))
    print("[Python] Token limits:", token_limits)

    try:
        # Construct context with PDF content and chat history
        context = f"""
PDF Content:
{pdf_data['text']}

PDF Metadata:
Title: {pdf_data['meta_info']['Title']}
Author: {pdf_data['meta_info']['Author']}
Pages: {pdf_data['meta_info']['Pages']}

Previous Conversation:
{chat_history}

Current Question: {question}
"""
        print("[Python] Context constructed, length:", len(context))
        print("[Python] Calling API...")
        
        # response = query_deepseek(context, token_limits)
        # response = query_ollama(context)
        # response = query_groq(context)
        response = query_multiple_groq(context)

        print("[Python] Got response from DeepSeek")
        print("[Python] Response length:", len(response))
        
        return jsonify({"answer": response})
    except Exception as e:
        print(f"[Python] Error in ask_question_target: {str(e)}")
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


        # Ollama streams chunks if `stream=True`, but returns full text if `stream=False`
        # result_text = ""
        # for line in response.iter_lines():
        #     if line:
        #         try:
        #             data = json.loads(line.decode("utf-8"))
        #             if "response" in data:
        #                 result_text += data["response"]
        #         except json.JSONDecodeError:
        #             continue

        # print("[Python] Received response from Ollama.")
        # return result_text.strip() or "No response generated."

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
            "content": "You are a helpful AI assistant specialized in analyzing and summarizing PDF content."
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
