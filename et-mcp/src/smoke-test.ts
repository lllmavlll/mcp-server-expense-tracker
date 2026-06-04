/**
 * End-to-end smoke test: connects to a running et-mcp HTTP server as a real
 * MCP client and exercises all 10 tools against the live DB. No browser, no
 * Inspector proxy — just Node → StreamableHTTP → server.
 *
 *   MCP_API_KEY=etmcp_... npm run smoke
 *   MCP_API_KEY=etmcp_... MCP_URL=http://localhost:3123/mcp npm run smoke
 *
 * It creates a couple of throwaway expenses, reads/edits/summarizes them, then
 * deletes what it created so your data is left clean.
 */
import { config as loadEnv } from "dotenv"
// No override: a key/URL passed on the command line wins over .env, so the
// negative-auth check (bogus key) isn't silently replaced by the .env key.
loadEnv()
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

// Default to the project's standard port. We deliberately do NOT derive this
// from process.env.PORT — that's the *server's* var and is easily shadowed by a
// stray `PORT` exported in the user's shell. Override with MCP_URL if needed.
const URL_STR = process.env.MCP_URL ?? "http://localhost:3123/mcp"
const API_KEY = process.env.MCP_API_KEY

if (!API_KEY) {
  console.error("✗ MCP_API_KEY is required (mint one in the Next.js /settings/api-keys UI)")
  process.exit(1)
}

let pass = 0
let fail = 0

function ok(label: string, detail?: unknown) {
  pass++
  console.log(`✓ ${label}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`)
}
function bad(label: string, err: unknown) {
  fail++
  console.error(`✗ ${label}: ${err instanceof Error ? err.message : JSON.stringify(err)}`)
}

/** Parse a tool result's first text block as JSON; throw on isError. */
function parse(raw: unknown): unknown {
  const result = raw as { content?: unknown; isError?: boolean }
  const content = (result.content ?? []) as { type: string; text?: string }[]
  const text = content.find((c) => c.type === "text")?.text ?? "null"
  const data = JSON.parse(text)
  if (result.isError) {
    const code = (data as { code?: string }).code ?? "ERROR"
    const message = (data as { message?: string }).message ?? text
    throw new Error(`${code}: ${message}`)
  }
  return data
}

async function main() {
  const client = new Client({ name: "et-mcp-smoke", version: "0.1.0" })
  const transport = new StreamableHTTPClientTransport(new URL(URL_STR), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
  })
  await client.connect(transport)
  console.log(`\nConnected to ${URL_STR}\n`)

  // 0. list tools
  const tools = await client.listTools()
  const names = tools.tools.map((t) => t.name).sort()
  console.log(`Tools (${names.length}): ${names.join(", ")}\n`)
  if (names.length === 10) ok("lists all 10 tools")
  else bad("tool count", `expected 10, got ${names.length}`)

  const call = async (name: string, args: Record<string, unknown>) =>
    parse(await client.callTool({ name, arguments: args }))

  const today = new Date().toISOString().slice(0, 10)
  const created: string[] = []

  // 1. add_expense (no date → today in tz; auto-creates category)
  try {
    const row = (await call("add_expense", {
      amount: "250",
      category: "SmokeTestCoffee",
      description: "smoke test",
    })) as { id: string; date: string; category: string }
    created.push(row.id)
    ok("add_expense", { id: row.id, date: row.date })
  } catch (e) { bad("add_expense", e) }

  // 9. list_categories (should now include the auto-created one)
  try {
    const cats = (await call("list_categories", {})) as { name: string }[]
    const has = cats.some((c) => c.name === "SmokeTestCoffee")
    has ? ok("list_categories (auto-created present)") : bad("list_categories", "auto category missing")
  } catch (e) { bad("list_categories", e) }

  // 10. add_category (custom). Idempotent: a duplicate from a prior run still
  // proves the tool + its uniqueness validation work.
  try {
    const cat = (await call("add_category", { name: "SmokeTestTravel" })) as { id: string; color: string }
    ok("add_category", { color: cat.color })
  } catch (e) {
    String(e).includes("already exists")
      ? ok("add_category (already exists — uniqueness enforced)")
      : bad("add_category", e)
  }

  // 3. bulk_add_expenses
  try {
    const res = (await call("bulk_add_expenses", {
      expenses: [
        { amount: "10.50", category: "SmokeTestCoffee", date: today },
        { amount: "99.99", category: "SmokeTestTravel" },
      ],
    })) as { created: number; rows: { id: string }[] }
    res.rows.forEach((r) => created.push(r.id))
    ok("bulk_add_expenses", { created: res.created })
  } catch (e) { bad("bulk_add_expenses", e) }

  // 5. get_expenses (filter by our category)
  try {
    const rows = (await call("get_expenses", { category: "SmokeTestCoffee", limit: 10 })) as unknown[]
    rows.length > 0 ? ok("get_expenses (filtered)", { count: rows.length }) : bad("get_expenses", "no rows")
  } catch (e) { bad("get_expenses", e) }

  // 6. get_expense_by_id
  if (created[0]) {
    try {
      const row = (await call("get_expense_by_id", { id: created[0] })) as { id: string } | null
      row && row.id === created[0] ? ok("get_expense_by_id") : bad("get_expense_by_id", "mismatch")
    } catch (e) { bad("get_expense_by_id", e) }
  }

  // 4. edit_expense
  if (created[0]) {
    try {
      const row = (await call("edit_expense", { id: created[0], amount: "275.00" })) as { amount: string }
      row.amount === "275.00" ? ok("edit_expense") : bad("edit_expense", `amount=${row.amount}`)
    } catch (e) { bad("edit_expense", e) }
  }

  // 7. get_spending_summary
  try {
    const sum = (await call("get_spending_summary", { period: "month" })) as {
      total: string; count: number
    }
    ok("get_spending_summary", { total: sum.total, count: sum.count })
  } catch (e) { bad("get_spending_summary", e) }

  // 8. get_expenses_by_category
  try {
    const rows = (await call("get_expenses_by_category", { from: today, to: today })) as unknown[]
    ok("get_expenses_by_category", { groups: rows.length })
  } catch (e) { bad("get_expenses_by_category", e) }

  // 2. delete_expense — first without confirm (expect CONFIRMATION_REQUIRED), then with
  if (created[0]) {
    try {
      await call("delete_expense", { id: created[0], confirm: false })
      bad("delete_expense (confirm=false)", "expected CONFIRMATION_REQUIRED but call succeeded")
    } catch (e) {
      String(e).includes("CONFIRMATION_REQUIRED")
        ? ok("delete_expense rejects without confirm")
        : bad("delete_expense (confirm=false)", e)
    }
  }

  // cleanup: delete everything we created
  let cleaned = 0
  for (const id of created) {
    try {
      await call("delete_expense", { id, confirm: true })
      cleaned++
    } catch (e) { bad(`cleanup delete ${id}`, e) }
  }
  ok("cleanup (deleted test rows)", { cleaned })

  await client.close()

  console.log(`\n${"─".repeat(40)}\n${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("\n✗ fatal:", err instanceof Error ? err.message : err)
  process.exit(1)
})
