# PDF Chat 💬📄

An interactive web application that lets you **chat with your PDF documents** using AI. Upload any PDF and ask questions to get contextual, intelligent answers powered by Groq's LLM API with automatic model fallback.

## ✨ Features

- 🚀 **Chat with any PDF** — upload a document and start asking questions
- 🤖 **Multi-model AI** — automatic fallback across Groq models (Llama 3.3 70B → Llama 4 Scout → Kimi K2 → Llama 3.1 8B)
- 🔒 **Secure authentication** — JWT-based auth with bcrypt password hashing
- 💾 **Persistent history** — save chat sessions and conversations (logged-in users)
- 🌓 **Dark/Light theme** — system-aware with manual toggle
- 📱 **Responsive design** — works on desktop and mobile
- 📊 **Session management** — rename, switch between, and organize PDF chats
- ✨ **Markdown rendering** — code highlighting, tables, and formatted AI responses
- 🛡️ **Production security** — Helmet.js, rate limiting, input validation, XSS protection

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | HTML, CSS, JavaScript, EJS, Bootstrap 5 |
| **Backend** | Node.js, Express.js |
| **AI Server** | Python, Flask, Groq API |
| **Database** | MongoDB (Mongoose) |
| **Auth** | JWT, bcrypt |
| **PDF Processing** | pdfplumber |
| **Security** | Helmet, express-rate-limit, express-validator |
| **DevOps** | Docker, Docker Compose, Render |

## 📋 Prerequisites

1. **Node.js** v18+ — [Download](https://nodejs.org/)
2. **Python** 3.8+ — [Download](https://www.python.org/downloads/)
3. **MongoDB** — [Download](https://www.mongodb.com/try/download/community) (default: `mongodb://localhost:27017/PDFchatbot`)
4. **Groq API Key** — [Get one free](https://console.groq.com/keys)

## 🚀 Quick Start

### 1. Clone and install

```bash
git clone <repository-url>
cd PdfChat
npm install
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your API keys and secrets
```

Required variables:
- `JWT_SECRET` — random string for JWT signing
- `SESSION_SECRET` — random string for session encryption
- `GROQ_API_KEY` — your Groq API key

### 3. Start MongoDB

Ensure MongoDB is running on `localhost:27017` (or set `MONGODB_URI` in `.env`).

### 4. Run the app

```bash
npm start
```

This concurrently starts:
- 🟢 **Node.js server** → http://localhost:3000
- 🐍 **Python ML server** → http://localhost:5001

### 5. Open your browser

Visit [http://localhost:3000](http://localhost:3000) and upload a PDF!

## 🐳 Docker Deployment

```bash
# Build and run all services
docker compose up --build

# Run in background
docker compose up -d
```

This spins up Node.js + Python + MongoDB automatically.

## ☁️ Render Deployment

The project includes a `render.yaml` for one-click deployment on [Render](https://render.com). Set these environment variables in the Render dashboard:

- `MONGODB_URI` — your MongoDB Atlas connection string
- `GROQ_API_KEY` — your Groq API key
- `DEEPSEEK_API_KEY` — (optional) OpenRouter API key

## 📁 Project Structure

```
PdfChat/
├── server.js              # Main Express app (entry point)
├── deepseek_server.py     # Python Flask AI server
├── routes/
│   ├── auth.js            # Login, signup, logout routes
│   └── chat.js            # Chat, upload, ask, rename routes
├── middleware/
│   ├── auth.js            # JWT authentication middleware
│   ├── rateLimiter.js     # Rate limiting configuration
│   ├── validators.js      # Input validation rules
│   └── errorHandler.js    # 404/500 error handlers
├── dbmodels/
│   └── user.js            # MongoDB user + session schema
├── views/
│   ├── index.ejs          # Main chat interface
│   ├── login.ejs          # Login/Signup page
│   └── error.ejs          # Error page template
├── public/
│   ├── stylesheets/       # CSS files
│   ├── javascripts/       # Client-side JS
│   └── images/            # Static assets
├── .env.example           # Environment variable template
├── Dockerfile             # Node.js container
├── Dockerfile.python      # Python container
├── docker-compose.yml     # Full stack orchestration
└── render.yaml            # Render deployment config
```

## 🔒 Security Features

- **Helmet.js** — HTTP security headers (CSP, HSTS, etc.)
- **Rate limiting** — prevents brute-force and API abuse
- **Input validation** — express-validator on all form inputs
- **JWT authentication** — httpOnly, sameSite, secure cookies
- **bcrypt** — password hashing with 10 salt rounds
- **DOMPurify** — XSS prevention on rendered markdown
- **CORS** — configurable origin restriction
- **Graceful shutdown** — clean MongoDB disconnect on SIGTERM

## 🧪 API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/` | Redirect to `/chat` | — |
| `GET` | `/chat` | Chat home page | Optional |
| `GET` | `/chat/:sessionId` | Chat session page | Optional |
| `POST` | `/upload` | Upload PDF | Optional |
| `POST` | `/ask` | Ask question (no session) | — |
| `POST` | `/ask/:sessionId` | Ask question in session | Optional |
| `POST` | `/create-user` | Register new user | — |
| `POST` | `/verify-login` | Login | — |
| `GET` | `/logout` | Logout | — |
| `POST` | `/rename/:sessionId` | Rename PDF session | Required |
| `GET` | `/health` | Health check | — |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.