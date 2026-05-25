# MCP Server Requirements: Expense Tracker

## 1. Purpose

Build a standalone MCP (Model Context Protocol) server that exposes the Expense Tracker database as a set of tools any MCP-compatible client (the Next.js app, Cursor, Claude.ai, Claude Desktop, etc.) can call. The server is the only component that talks to the database directly.

The Next.js app already exists and is functional. The MCP server is an additive layer — it must read from and write to the same Neon database the Next.js app uses, without breaking existing UI flows.

---

## 2. Scope

### In scope
- Read and write access to `expenses` and `categories` tables
- Per-user data isolation (the DB is multi-tenant — see §5)
- Streamable HTTP transport so remote MCP clients can connect
- Local stdio transport for development with MCP Inspector / Claude Desktop
- Tool set covering add, bulk-add, edit, delete, query, summarize

### Out of scope (for v1)
- Auth/session/user table writes — those stay in the Next.js app
- Chat history tables (`chat_sessions`, `chat_messages`) — those are the app's concern
- User signup, password resets, profile edits
- Rate limiting beyond what the host platform provides

---

## 3. Functional Requirements

### 3.1 Tools to expose

| # | Tool | Purpose | Inputs | Returns |
|---|---|---|---|---|
| 1 | `add_expense` | Add a single expense | amount, category, date, description? | created expense row |
| 2 | `bulk_add_expenses` | Add many expenses in one call | array of expense objects | array of created rows + counts |
| 3 | `edit_expense` | Update an existing expense | id, partial fields | updated row |
| 4 | `delete_expense` | Delete one expense | id, **confirm: true** | `{ deleted: true, id }` |
| 5 | `get_expenses` | Filtered list | search?, category?, from?, to?, limit?, offset? | array of rows |
| 6 | `get_expense_by_id` | Fetch single expense | id | single row or null |
| 7 | `get_spending_summary` | Totals by period | period: week\|month\|year, anchor_date? | `{ total, count, by_category, by_period }` |
| 8 | `get_expenses_by_category` | Category breakdown for a range | from, to | `[{ category, total, count }]` |
| 9 | `list_categories` | List user's categories | — | array of categories |
| 10 | `add_category` | Create a custom category | name, color | created row |

> All tools must enforce ownership: a tool call can only see/modify rows belonging to the calling user (see §5).

### 3.2 Tool input/output rules
- Date inputs accept ISO `YYYY-MM-DD`. Reject anything else with a clear error.
- If `date` is omitted on `add_expense` / `bulk_add_expenses`, default to **today in the user's timezone**. The user record has no timezone column today — add `users.timezone varchar(64) DEFAULT 'UTC'` (IANA name) as part of this work, populated from the browser on first chat session if missing.
- Amounts are decimal strings or numbers; serialized back as strings to match Drizzle's `numeric` type.
- Currency is **not** a tool input. All amounts are stored and returned as raw decimals; the user's `users.currency` is the implicit unit. Display formatting (₹, $) is the client's job.
- **Category auto-create:** when an expense is added with a category that doesn't exist in the user's `categories` table, the server creates it on the fly with a deterministic default color (pick from a fixed palette by hashing the name) and `is_default = false`. This keeps the categories list and the expenses list consistent.
- `delete_expense` requires `confirm: true`. Without it, the tool returns `VALIDATION_ERROR` with a message instructing the model to re-call with confirm. This makes destructive calls a deliberate two-step from the LLM's perspective.
- Errors must be returned as MCP error responses with a human-readable `message` and a stable `code` (`NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `CONFIRMATION_REQUIRED`, `DB_ERROR`).

### 3.3 Tool descriptions
Each tool's `description` field is the primary signal the LLM uses to choose the tool. Descriptions must:
- State what the tool does in one sentence
- List required inputs and their formats
- Note any defaults (e.g., "if `date` is omitted, today is used")
- Mention return shape briefly

---

## 4. Database Requirements

### 4.1 Same database as the Next.js app
The MCP server connects to the **same Neon database** the Next.js app uses. No data duplication.

### 4.2 Schema source of truth
The Next.js app currently owns the Drizzle schema at `expense-tracker/lib/db/schema/`. The MCP server must use a schema definition that matches it exactly for the tables it touches (`users` for FK, `expenses`, `categories`, `mcp_api_keys`).

**Decision (confirmed):** copy the relevant Drizzle schema files into `et-mcp/src/db/schema/`. The Next.js app remains the migration owner — `et-mcp` only reads the schema, never `drizzle-kit push`es. When the Next.js schema changes, copy the updated files into `et-mcp/` as part of the same change.

### 4.3 Migrations
Migrations remain owned by the Next.js app (`drizzle-kit push` from `expense-tracker/`). The MCP server is **read/write but never schema-altering**.

---

## 5. Authentication & Per-User Isolation

This is the central design issue and must be resolved before implementation.

The DB is multi-tenant: `expenses.user_id` and `categories.user_id` are NOT NULL FKs to `users.id`. Every tool call needs to know **which user** is making the request.

### 5.1 Required behavior
- Every tool MUST scope queries by a `userId` derived from the caller's credentials.
- Cross-tenant reads or writes MUST be impossible — even if a client passes someone else's `id` in tool args, the server must reject it.
- The server MUST NOT accept `user_id` as a tool argument from clients.

### 5.2 Auth approach (confirmed): per-user API key

- User mints a key in `/settings/api-keys` in the Next.js app.
- Plaintext key is shown **once** at creation, then never again. Server stores only a hash.
- MCP client sends it on every request as `Authorization: Bearer <key>`.
- For Streamable HTTP, the header is set on the initial connection. For stdio (local Claude Desktop / Inspector), the key is passed via `MCP_API_KEY` env var in the client's MCP config.
- On each tool call, the server: (1) hash-matches the key against `mcp_api_keys`, (2) checks `revoked_at IS NULL`, (3) updates `last_used_at`, (4) resolves `user_id` and injects it into the tool's request context.

### 5.3 New table

```
mcp_api_keys
  id            uuid PK
  user_id       uuid FK → users
  name          varchar(100)        — user-chosen label
  key_hash      text                — bcrypt or sha256 of the key
  last_used_at  timestamp nullable
  created_at    timestamp
  revoked_at    timestamp nullable
```

The plaintext key is shown to the user once at creation, never stored. Add a `/settings/api-keys` UI in the Next.js app to mint/list/revoke.

Key format: `etmcp_<32 random url-safe chars>` (prefix makes leaks easy to grep for in logs and helps identify the key type).

---

## 6. Technical Requirements

### 6.1 Stack
- Node.js (TypeScript), current LTS (Node 22)
- npm (matching the Next.js app — single lockfile style across the monorepo)
- `@modelcontextprotocol/sdk` (latest)
- Drizzle ORM + `@neondatabase/serverless`
- `zod` for tool input validation
- HTTP framework: built-in Node `http` or `hono`/`express` — whatever the MCP SDK's Streamable HTTP transport recommends at implementation time

### 6.2 Transports
Both must be supported:
- **Streamable HTTP** — for remote clients (Cursor, Claude.ai, the Next.js chat API)
- **stdio** — for local development with MCP Inspector and Claude Desktop

### 6.3 Logging & observability
- Structured logs (JSON) for tool call name, user id (hashed or last 4), latency, success/error
- No PII in logs (no expense descriptions, no full emails)
- A `/healthz` HTTP endpoint returning 200 when DB connection is live

---

## 7. Project Structure

```
et-mcp/
├── src/
│   ├── index.ts              ← entry: picks transport from env, registers tools
│   ├── server.ts             ← creates MCP Server, registers tools
│   ├── auth.ts               ← API-key verification middleware
│   ├── context.ts            ← per-request user context (userId)
│   ├── db/
│   │   ├── client.ts         ← Drizzle + Neon
│   │   └── schema/           ← copied from expense-tracker
│   ├── tools/
│   │   ├── add-expense.ts
│   │   ├── bulk-add-expenses.ts
│   │   ├── edit-expense.ts
│   │   ├── delete-expense.ts
│   │   ├── get-expenses.ts
│   │   ├── get-expense-by-id.ts
│   │   ├── get-spending-summary.ts
│   │   ├── get-expenses-by-category.ts
│   │   ├── list-categories.ts
│   │   └── add-category.ts
│   └── lib/
│       ├── errors.ts         ← typed error mapping
│       └── validation.ts     ← shared zod schemas (date, amount, etc.)
├── package.json
├── tsconfig.json
└── README.md                 ← how to run, how to mint an API key, how to connect from each client
```

---

## 8. Environment Variables

```
DATABASE_URL=         # same Neon URL as the Next.js app
PORT=3001             # HTTP port for Streamable HTTP transport
MCP_TRANSPORT=http    # 'http' | 'stdio' (default 'http')
NODE_ENV=             # 'development' | 'production'
LOG_LEVEL=info        # 'debug' | 'info' | 'warn' | 'error'
```

No `ANTHROPIC_API_KEY` here — the MCP server does not call any LLM. The LLM lives in the client (Next.js chat route, Cursor, Claude.ai).

---

## 9. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Latency (single-row tool) | p95 < 300ms over warm DB connection |
| Latency (summary tool) | p95 < 800ms |
| Concurrent connections | At least 50 (Railway/Render free tier) |
| Uptime | 99% (single-instance is acceptable for v1) |
| Input validation | Every tool input validated with zod before any DB call |
| SQL safety | All queries via Drizzle — no raw SQL with user input |
| Secrets handling | API keys hashed at rest; plaintext shown to user only once |

---

## 10. Deployment

- **Local dev (v1 focus):** `npm run dev` runs the server on `localhost:3001` with hot reload. All testing — MCP Inspector, Cursor, Claude Desktop, the Next.js chat route — happens against the local server first.
- **Production hosting:** deferred. Pick Railway or Render once the local end-to-end flow is proven. Vercel is not an option (serverless functions can't hold the persistent connection MCP needs).
- **Public URL:** when deployed, a stable HTTPS URL so Claude.ai / Cursor can register it as a remote MCP server.

---

## 11. Resolved Decisions

| # | Decision | Implementation note |
|---|---|---|
| 1 | **Auth** — per-user API key | New `mcp_api_keys` table; `Authorization: Bearer etmcp_...`; plaintext shown once |
| 2 | **Schema** — copy files into `et-mcp/` | Next.js app remains the migration owner; `et-mcp` never runs `drizzle-kit push` |
| 3 | **Category auto-create** — yes | If category not in user's `categories`, insert it with a hashed-default color and `is_default = false` |
| 4 | **Date default** — user's timezone | Adds `users.timezone` (IANA name, default `'UTC'`); Next.js sets it from `Intl.DateTimeFormat().resolvedOptions().timeZone` on first chat session |
| 5 | **Currency** — no tool-level override | Tools never accept/return a currency code; `users.currency` is the implicit unit; clients format display |
| 6 | **Delete confirmation** — required | `delete_expense` needs `confirm: true`; without it, returns `CONFIRMATION_REQUIRED` |

---

## 12. Acceptance Criteria

The MCP server is "done" for v1 when all of the following pass:

1. MCP Inspector can list all 10 tools and call each one successfully against a real Neon dev DB.
2. From Cursor (or Claude Desktop), connecting with a valid API key:
   - "Show my expenses this month" returns rows owned by that user only.
   - "Add ₹250 for coffee today" creates a row visible in the Next.js dashboard.
   - "Delete the coffee expense from today" removes only that row.
3. A request with no API key, an invalid key, or a revoked key is rejected with `FORBIDDEN`.
4. A tool call attempting to access another user's expense ID returns `NOT_FOUND` (not `FORBIDDEN` — don't leak existence).
5. The Next.js app's chat route can connect via `experimental_createMCPClient` and round-trip a tool call end-to-end.
6. `/healthz` returns 200; structured logs show every tool call with user, tool, latency, outcome.

---

## 13. Implementation Order

1. **Schema additions in the Next.js app** — add `mcp_api_keys` and `users.timezone` to `expense-tracker/lib/db/schema/`, run `drizzle-kit push`. Ship a `/settings/api-keys` UI to mint/list/revoke keys.
2. **Scaffold `et-mcp/`** — `package.json`, `tsconfig.json`, install `@modelcontextprotocol/sdk`, `drizzle-orm`, `@neondatabase/serverless`, `zod`.
3. **DB layer** — copy schema files from the Next.js app into `et-mcp/src/db/schema/`; set up `client.ts`.
4. **Auth middleware + request context** — verify `Authorization: Bearer etmcp_...`, hash-match against `mcp_api_keys`, resolve `userId`, expose it to tools via per-request context.
5. **Tools** — implement in this order so each builds on the previous: `add_expense` → `get_expenses` → `bulk_add_expenses` → `edit_expense` → `delete_expense` (with confirm) → `get_expense_by_id` → `list_categories` → `add_category` → `get_spending_summary` → `get_expenses_by_category`. Unit test each against a test DB.
6. **Streamable HTTP transport** — wire it up; verify all 10 tools via MCP Inspector.
7. **stdio transport** — verify locally with Claude Desktop config.
8. **Deploy** — Railway or Render, with production `DATABASE_URL`. Confirm `/healthz` returns 200.
9. **Wire the Next.js chat route** — `experimental_createMCPClient` pointed at the deployed URL, with the user's API key forwarded from session.
10. **End-to-end verification** — run through §12 acceptance criteria from each target client (Next.js app, Cursor, Claude.ai).
