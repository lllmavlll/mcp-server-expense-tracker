# et-mcp

MCP (Model Context Protocol) server for the Expense Tracker. Exposes the same Neon
database the Next.js app uses as a set of tools any MCP-compatible client can call
(Cursor, Claude Desktop, Claude.ai, the Next.js chat route, MCP Inspector).

The Next.js app is the schema/migration owner. This package only reads and writes
rows in `expenses`, `categories`, `mcp_api_keys`, and `users`.

## Setup

```bash
cd et-mcp
npm install
cp .env.example .env
# fill in DATABASE_URL (same Neon URL the Next.js app uses)
npm run dev
```

The server starts on `http://localhost:3001`.

- `GET /healthz` → `{ ok: true }` when the DB is reachable
- `POST /mcp`     → Streamable HTTP MCP endpoint (requires `Authorization: Bearer etmcp_...`)

## Authentication

Every tool call is scoped to the user who owns the API key.

1. Sign in to the Next.js app
2. Go to `/settings/api-keys`
3. Create a key (the plaintext `etmcp_...` is shown **once** — copy it)
4. Send it on every MCP request as `Authorization: Bearer etmcp_...`

Revoking the key in the Next.js UI takes effect on the next call.

## Transports

| Transport | When to use | Configure |
|---|---|---|
| `http` (default) | Cursor, Claude.ai, the Next.js chat route, MCP Inspector | `MCP_TRANSPORT=http`, `PORT=3001` |
| `stdio` | Claude Desktop, local Inspector via subprocess | `MCP_TRANSPORT=stdio`, `MCP_API_KEY=etmcp_...` |

## Connecting clients

### MCP Inspector (HTTP)

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL: http://localhost:3001/mcp
# Header: Authorization = Bearer etmcp_...
```

### Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "expense-tracker": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/et-mcp/src/index.ts"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "DATABASE_URL": "postgres://...",
        "MCP_API_KEY": "etmcp_..."
      }
    }
  }
}
```

### Cursor (HTTP)

```json
{
  "mcpServers": {
    "expense-tracker": {
      "url": "http://localhost:3001/mcp",
      "headers": { "Authorization": "Bearer etmcp_..." }
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `add_expense` | Add a single expense |
| `bulk_add_expenses` | Add up to 100 expenses |
| `edit_expense` | Update fields on an expense |
| `delete_expense` | Delete an expense (requires `confirm: true`) |
| `get_expenses` | Filtered list (search, category, date range, paging) |
| `get_expense_by_id` | Single expense by id |
| `get_spending_summary` | Totals for week/month/year |
| `get_expenses_by_category` | Category breakdown for a date range |
| `list_categories` | All categories for the user |
| `add_category` | Create a custom category |

## Project layout

```
src/
├── index.ts              # entry: picks transport from MCP_TRANSPORT
├── server.ts             # MCP server + tool registration
├── auth.ts               # sha256 bearer-key verification
├── context.ts            # AsyncLocalStorage userId/timezone/currency
├── db/
│   ├── client.ts         # Drizzle + Neon (lazy)
│   └── schema/           # copied from expense-tracker; do not edit here
├── transports/
│   ├── http.ts           # Streamable HTTP via Hono
│   └── stdio.ts          # stdio for Claude Desktop / Inspector subprocess
├── tools/
│   └── *.ts              # one file per tool
└── lib/
    ├── errors.ts
    ├── validation.ts
    ├── timezone.ts
    ├── category-color.ts
    └── logger.ts
```

## Notes

- `et-mcp` never runs `drizzle-kit push`. When the Next.js schema changes, copy the
  updated files from `expense-tracker/lib/db/schema/` into `src/db/schema/`.
- The HTTP transport is **stateless** (`sessionIdGenerator: undefined`): one
  transport+server per POST. Simpler concurrency, no cross-request session state.
- Logs are JSON to stderr (so stdout stays clean for the stdio JSON-RPC channel).
