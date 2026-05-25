# Technical Design Document: Expense Tracker with MCP Server

## Overview

An expense tracker web application with a standalone MCP (Model Context Protocol) server. Users can manage and analyze their expenses through a natural language chat interface. The MCP server is client-agnostic — any MCP-compatible client (the app itself, Cursor, Claude.ai, etc.) can connect to it and interact with the expense database.

---

## Problem Statement

Traditional expense trackers require users to navigate UI forms to add, edit, or analyze expenses. This project adds an AI-powered natural language layer via MCP, allowing users (or developers via Cursor) to interact with expense data conversationally — adding bulk entries, querying spending patterns, editing records — all through plain English.

---

## Goals

- Build a full-stack expense tracker UI with Next.js
- Build a standalone MCP server with direct DB access
- Support read AND write operations via MCP tools (add, bulk add, edit, delete, query)
- MCP server is reusable — not tied to any single client app
- Any MCP-compatible client can connect and use the same tools

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   MCP Clients                        │
│  Next.js App   │   Cursor   │   Claude.ai   │  etc.  │
└────────┬───────┴─────┬──────┴───────┬───────┴────────┘
         │             │              │
         └─────────────┴──────────────┘
                       │  MCP Protocol (Streamable HTTP)
                       ▼
         ┌─────────────────────────────┐
         │        MCP Server           │
         │  (Standalone Node.js app)   │
         │                             │
         │  Tools:                     │
         │  - add_expense              │
         │  - bulk_add_expenses        │
         │  - edit_expense             │
         │  - delete_expense           │
         │  - get_expenses             │
         │  - get_spending_summary     │
         │  - get_expenses_by_category │
         │  - get_expenses_by_range    │
         │                             │
         │  Drizzle ORM                │
         └──────────────┬──────────────┘
                        │
                        ▼
         ┌─────────────────────────────┐
         │         Neon DB             │
         │      (Serverless Postgres)  │
         └─────────────────────────────┘
```

---

## Project Structure

Two separate projects in the monorepo:

```
expense-tacker-with-mcp/
├── docs/                   ← This document
├── expense-tracker/        ← Next.js app (UI + chat API + MCP client)
└── et-mcp/                 ← Standalone MCP server
```

---

## Part 1: MCP Server (`et-mcp/`)

### Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js (TypeScript) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Transport | Streamable HTTP |
| ORM | Drizzle ORM |
| Database | Neon (Serverless Postgres) |
| Hosting | Railway or Render (persistent server needed) |

### Why not Vercel for the MCP server?

Vercel runs serverless functions — they spin up per request and have no persistent process. MCP servers need to maintain an active connection with clients. Railway/Render run persistent Node.js processes, which is the right fit.

### DB Schema (Drizzle)

```typescript
// et-mcp/src/db/schema.ts

export const expenses = pgTable('expenses', {
  id: uuid('id').defaultRandom().primaryKey(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  description: text('description'),
  date: date('date').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  color: varchar('color', { length: 7 }), // hex color for UI
});
```

### MCP Tools

Each tool has a name, description (what the AI uses to decide when to call it), and an input schema.

| Tool | Description | Key Inputs |
|---|---|---|
| `add_expense` | Add a single expense | amount, category, description, date |
| `bulk_add_expenses` | Add multiple expenses at once | array of expense objects |
| `edit_expense` | Update an existing expense | id, fields to update |
| `delete_expense` | Remove an expense by ID | id |
| `get_expenses` | Fetch expenses with optional filters | category, date range, limit |
| `get_spending_summary` | Aggregated totals by period | period (week/month/year) |
| `get_expenses_by_category` | Breakdown by category | date range |
| `get_expenses_by_range` | All expenses between two dates | start_date, end_date |

### MCP Server File Structure

```
et-mcp/
├── src/
│   ├── index.ts          ← Server entry, registers tools, starts HTTP listener
│   ├── db/
│   │   ├── client.ts     ← Drizzle + Neon connection
│   │   └── schema.ts     ← Table definitions
│   └── tools/
│       ├── add.ts
│       ├── bulk-add.ts
│       ├── edit.ts
│       ├── delete.ts
│       └── query.ts
├── package.json
└── tsconfig.json
```

---

## Part 2: Next.js App (`expense-tracker/`)

### Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14+ (App Router) |
| AI SDK | Vercel AI SDK (`ai` package) |
| AI Model | Claude (via Anthropic provider) |
| MCP Client | Built into Vercel AI SDK (`experimental_createMCPClient`) |
| Styling | Tailwind CSS |
| Hosting | Vercel |

### Key Routes

```
expense-tracker/
├── app/
│   ├── page.tsx                  ← Dashboard (expense list, charts)
│   ├── chat/
│   │   └── page.tsx              ← Chat interface (natural language)
│   └── api/
│       └── chat/
│           └── route.ts          ← AI endpoint with MCP client
```

### How the Chat API Route Works

```typescript
// app/api/chat/route.ts

import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { experimental_createMCPClient } from 'ai'

export async function POST(req: Request) {
  const { messages } = await req.json()

  // 1. Connect MCP client to your standalone MCP server
  const mcpClient = await experimental_createMCPClient({
    transport: {
      type: 'sse',
      url: process.env.MCP_SERVER_URL, // your Railway/Render URL
    },
  })

  // 2. Get tool definitions from MCP server
  const tools = await mcpClient.tools()

  // 3. Stream response from Claude with MCP tools available
  const result = streamText({
    model: createAnthropic()('claude-sonnet-4-6'),
    messages,
    tools,
  })

  return result.toDataStreamResponse()
}
```

The AI SDK handles the full loop — Claude decides which tool to call, the MCP client executes it against your MCP server, the result comes back to Claude, and Claude forms its final response.

---

## Data Flow: End-to-End Example

**User says:** "I spent $45 on groceries and $12 on coffee yesterday"

```
1. User types in chat UI
2. Message sent to POST /api/chat
3. MCP client connects to MCP server, fetches tools list
4. Claude receives message + tool definitions
5. Claude decides to call bulk_add_expenses with:
   [
     { amount: 45, category: "groceries", date: "2026-03-23" },
     { amount: 12, category: "coffee",    date: "2026-03-23" }
   ]
6. MCP client sends tool call to MCP server
7. MCP server runs Drizzle insert queries against Neon DB
8. MCP server returns: "2 expenses added successfully"
9. Claude responds: "Added! $45 for groceries and $12 for coffee on March 23rd."
10. Response streamed back to UI
```

---

## Multi-Client Access

The MCP server URL (e.g., `https://et-mcp.railway.app`) is a public endpoint. Any MCP client can connect:

| Client | How to connect |
|---|---|
| Your Next.js app | Via `experimental_createMCPClient` in the chat API route |
| Cursor | Add MCP server URL in Cursor's MCP settings |
| Claude.ai | Add as a remote MCP server in Claude.ai settings |
| Any MCP client | Point to the server URL, uses Streamable HTTP |

---

## Environment Variables

### MCP Server (`et-mcp/`)
```
DATABASE_URL=          # Neon connection string
PORT=3001              # HTTP port
```

### Next.js App (`expense-tracker/`)
```
ANTHROPIC_API_KEY=     # Claude API key
MCP_SERVER_URL=        # URL of deployed MCP server
```

---

## Implementation Order

1. **Set up Neon DB** — create database, get connection string
2. **Build MCP server** — schema, Drizzle client, tools, HTTP server
3. **Test MCP server locally** — use MCP Inspector or connect via Cursor
4. **Deploy MCP server** — Railway or Render
5. **Build Next.js app** — dashboard UI, chat UI, chat API route with MCP client
6. **Connect & test end-to-end** — natural language → MCP tool → DB → response
7. **Deploy Next.js app** — Vercel

---

## Verification / Testing

- **MCP server locally**: Use [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (`npx @modelcontextprotocol/inspector`) to connect and manually call tools
- **Cursor integration**: Add local MCP server URL in Cursor settings, ask "show my expenses"
- **End-to-end**: Run the full Next.js app, type "add $50 groceries today" in chat, verify row appears in Neon DB console
- **Cross-client**: Connect Claude.ai to the deployed MCP server URL, verify same tools work

---

## Key Concepts Recap

| Concept | Role in this project |
|---|---|
| **MCP Server** | Standalone service, knows your DB schema, exposes tools |
| **MCP Client** | Lives inside Next.js chat API route, calls MCP server on AI's behalf |
| **AI Model (Claude)** | Decides which tool to call based on user's message |
| **Streamable HTTP** | Transport protocol between MCP client and server |
| **Neon DB** | The actual data store — only the MCP server talks to it directly |
