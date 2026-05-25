# DB Schema & API Plan: Expense Tracker

## Context

The UI is built with mock data and in-memory state. This plan covers the full database schema (all tables) and the Next.js API routes needed to make the application functional. MCP-related APIs are excluded — those come later when the MCP server is built.

Stack: **Neon (Postgres) + Drizzle ORM + NextAuth.js (Auth.js v5)** inside the existing Next.js app.

---

## Auth Approach

**NextAuth.js v5** with:
- **Credentials provider** — email/password login
- **Drizzle adapter** — stores sessions and users in Neon DB
- **JWT strategy** — stateless sessions (simpler for Neon serverless)

NextAuth requires its own tables. We'll use the Drizzle adapter schema and extend the `users` table with our app-specific columns.

---

## All Tables

### 1. `users`
Core user record + profile + preferences. Extended from NextAuth's required user shape.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| name | varchar(100) | |
| email | varchar(255) | unique, not null |
| email_verified | timestamp | NextAuth field |
| image | text | avatar URL |
| password_hash | text | nullable (null for OAuth) |
| currency | varchar(10) | default 'INR' |
| date_format | varchar(20) | default 'DD/MM/YYYY' |
| default_category | varchar(100) | default 'Food' |
| theme | varchar(20) | default 'system' |
| created_at | timestamp | defaultNow() |
| updated_at | timestamp | defaultNow() |

---

### 2. `accounts`
Required by NextAuth for OAuth provider linking (even if only using credentials now, keeps door open for Google/GitHub login).

| Column | Type | Notes |
|---|---|---|
| user_id | uuid FK → users | |
| type | varchar | 'credentials' \| 'oauth' |
| provider | varchar | |
| provider_account_id | varchar | |
| refresh_token | text | nullable |
| access_token | text | nullable |
| expires_at | integer | nullable |
| token_type | varchar | nullable |
| scope | varchar | nullable |
| id_token | text | nullable |
| session_state | varchar | nullable |

---

### 3. `sessions`
Required by NextAuth for database sessions (used if JWT strategy is not enough).

| Column | Type | Notes |
|---|---|---|
| session_token | varchar PK | |
| user_id | uuid FK → users | |
| expires | timestamp | |

---

### 4. `verification_tokens`
Required by NextAuth for magic link / email verification.

| Column | Type | Notes |
|---|---|---|
| identifier | varchar | |
| token | varchar | |
| expires | timestamp | |

---

### 5. `categories`
User-managed categories with display colors. Pre-seeded with defaults (Food, Transport, etc.) per user on signup.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| user_id | uuid FK → users | |
| name | varchar(100) | unique per user |
| color | varchar(7) | hex color e.g. '#f59e0b' |
| is_default | boolean | default false — system presets |
| created_at | timestamp | defaultNow() |

---

### 6. `expenses`
Core table. Category stored as a string (not FK) for flexibility and simpler MCP queries later.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| user_id | uuid FK → users | |
| amount | numeric(10, 2) | not null |
| category | varchar(100) | not null |
| description | text | nullable |
| date | date | not null |
| created_at | timestamp | defaultNow() |
| updated_at | timestamp | defaultNow() |

> Category is stored as a plain string (not a FK to categories) so the MCP server can add expenses without needing to resolve category IDs. The categories table is for display/color management only.

---

### 7. `chat_sessions`
Groups messages into conversation threads. Each time user opens a new chat, a session is created.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| user_id | uuid FK → users | |
| title | varchar(255) | nullable — auto-set from first message |
| created_at | timestamp | defaultNow() |
| updated_at | timestamp | defaultNow() |

---

### 8. `chat_messages`
Individual messages in a session. `tool_calls` stores the MCP tool invocations so the AI's reasoning is transparent to the user later.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| session_id | uuid FK → chat_sessions | |
| role | varchar(20) | 'user' \| 'assistant' \| 'tool' |
| content | text | message text |
| tool_calls | jsonb | nullable — stores MCP tool call details |
| created_at | timestamp | defaultNow() |

---

## Drizzle Schema (file layout)

```
lib/db/
├── client.ts       ← Drizzle + Neon connection
├── schema/
│   ├── auth.ts     ← users, accounts, sessions, verification_tokens
│   ├── expenses.ts ← expenses, categories
│   └── chat.ts     ← chat_sessions, chat_messages
└── index.ts        ← re-exports all schema tables
```

---

## API Routes

### Auth — `/api/auth/[...nextauth]`
Handled entirely by NextAuth. No custom routes needed.

- `POST /api/auth/signin` — login (credentials)
- `POST /api/auth/signout` — logout
- `GET /api/auth/session` — current session

---

### Expenses — `/api/expenses`

| Method | Route | Description |
|---|---|---|
| GET | `/api/expenses` | List user's expenses. Query params: `search`, `category`, `from`, `to`, `limit`, `offset` |
| POST | `/api/expenses` | Create a new expense |
| PATCH | `/api/expenses/[id]` | Update an expense |
| DELETE | `/api/expenses/[id]` | Delete an expense |
| GET | `/api/expenses/summary` | Returns totals by category + monthly data for dashboard |

---

### Categories — `/api/categories`

| Method | Route | Description |
|---|---|---|
| GET | `/api/categories` | List user's categories (includes defaults) |
| POST | `/api/categories` | Create a custom category |
| PATCH | `/api/categories/[id]` | Rename / recolor a category |
| DELETE | `/api/categories/[id]` | Delete a custom category |

---

### User/Settings — `/api/user`

| Method | Route | Description |
|---|---|---|
| GET | `/api/user` | Get current user profile + preferences |
| PATCH | `/api/user` | Update name, email, currency, date_format, default_category, theme |

---

### Chat — `/api/chat`

| Method | Route | Description |
|---|---|---|
| GET | `/api/chat/sessions` | List user's chat sessions |
| POST | `/api/chat/sessions` | Create a new session |
| GET | `/api/chat/sessions/[id]` | Get a session with its messages |
| POST | `/api/chat` | Send a message — streams response via Vercel AI SDK + MCP client |

> `/api/chat` is the streaming endpoint. For now (before MCP server is ready) it can respond with a simple AI reply. The MCP wiring is added later.

---

## File Structure After Implementation

```
expense-tracker/
├── lib/
│   ├── db/
│   │   ├── client.ts
│   │   ├── index.ts
│   │   └── schema/
│   │       ├── auth.ts
│   │       ├── expenses.ts
│   │       └── chat.ts
│   ├── mock-data.ts        ← keep for now, swap with real API calls later
│   └── utils.ts
│
└── app/
    └── api/
        ├── auth/
        │   └── [...nextauth]/route.ts
        ├── expenses/
        │   ├── route.ts          (GET, POST)
        │   ├── [id]/route.ts     (PATCH, DELETE)
        │   └── summary/route.ts  (GET)
        ├── categories/
        │   ├── route.ts          (GET, POST)
        │   └── [id]/route.ts     (PATCH, DELETE)
        ├── user/
        │   └── route.ts          (GET, PATCH)
        └── chat/
            ├── route.ts          (POST — streaming)
            └── sessions/
                ├── route.ts      (GET, POST)
                └── [id]/route.ts (GET)
```

---

## New Dependencies Needed

```
npm install drizzle-orm @neondatabase/serverless
npm install drizzle-kit --save-dev
npm install next-auth@beta @auth/drizzle-adapter
npm install bcryptjs
npm install @types/bcryptjs --save-dev
```

---

## Implementation Order

1. **Set up Neon DB** — create project, get `DATABASE_URL`
2. **Install dependencies** — Drizzle, Neon serverless driver, NextAuth, bcryptjs
3. **Write Drizzle schema** — all 8 tables across 3 schema files
4. **Run migrations** — `drizzle-kit push` to Neon
5. **Set up NextAuth** — configure with credentials provider + Drizzle adapter
6. **Build API routes** — expenses → categories → user → chat (in this order)
7. **Swap mock data** — replace `mockExpenses` usage in pages with real API calls
8. **Seed default categories** — on user signup, insert the 7 default categories

---

## Verification

- Register a new user via `/login`, verify row appears in Neon `users` table
- Add an expense via UI, verify row in `expenses` table
- Check `/api/expenses/summary` returns correct aggregated totals
- Open chat, send a message, verify rows appear in `chat_sessions` and `chat_messages`
- Update preferences in settings, verify `users` table reflects changes
