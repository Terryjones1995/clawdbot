# OpenClaw

An AI agent workspace gateway with a built-in login system. Manages agent prompt files, shared prompts, and optional skills — all behind an authenticated web interface.

## Features

- Web-based login with username/password authentication
- JWT sessions stored in `httpOnly` cookies (8-hour TTL)
- bcrypt password hashing
- Protected dashboard
- CLI tool to create and manage users
- Configurable via environment variables

## Requirements

- Node.js 18+
- npm

## Setup

**1. Clone and install dependencies:**
```bash
git clone https://github.com/Terryjones1995/clawdbot
cd clawdbot
npm install
```

**2. Create your `.env` file:**
```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
OPENCLAW_GATEWAY_TOKEN=your_token_here
OPENCLAW_PORT=18789

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your_secret_here
```

**3. Create your first user:**
```bash
npm run create-user
```

**4. Start the server:**
```bash
npm start
```

Visit `http://localhost:18789` — you'll be redirected to the login page.

## Project Structure

```
├── server.js                  # Express gateway entry point
├── src/
│   ├── routes/auth.js         # Login, logout, and /me endpoints
│   ├── middleware/requireAuth.js  # JWT auth guard
│   └── data/users.json        # User store (gitignored, created at runtime)
├── public/
│   ├── login.html             # Login page
│   └── dashboard.html         # Protected dashboard
├── scripts/
│   └── create-user.js         # CLI to add users
├── openclaw/
│   ├── agents/                # Agent prompt files
│   ├── prompts/               # Shared prompt fragments
│   ├── skills/                # Optional tools and skills
│   └── config/                # Configuration files
├── logs/                      # Runtime logs (not committed)
└── memory/                    # Runtime memory/state (not committed)
```

## Auth Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | Authenticate and receive a session cookie |
| `POST` | `/auth/logout` | Clear the session cookie |
| `GET` | `/auth/me` | Return the current user's info |

## User Management

Add a new user interactively:
```bash
npm run create-user
```

Users are stored in `src/data/users.json` (gitignored). Each user has a `username`, bcrypt-hashed `passwordHash`, `role` (`admin` or `user`), and a `createdAt` timestamp.
