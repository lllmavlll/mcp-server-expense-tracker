import type { IncomingMessage, ServerResponse } from "node:http"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { sql } from "drizzle-orm"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { authenticate } from "../auth.js"
import { runWithContext } from "../context.js"
import { db } from "../db/client.js"
import { ToolError } from "../lib/errors.js"
import { log } from "../lib/logger.js"
import { createMcpServer } from "../server.js"

type NodeEnv = { Bindings: { incoming: IncomingMessage; outgoing: ServerResponse } }

export async function startHttp(port: number): Promise<void> {
  const app = new Hono<NodeEnv>()

  app.get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`)
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false }, 503)
    }
  })

  // Stateless: each POST creates a fresh transport+server. Auth runs every call.
  // This sidesteps cross-request session state and keeps AsyncLocalStorage clean,
  // and is what experimental_createMCPClient + Inspector expect by default.
  app.all("/mcp", async (c) => {
    const incoming = c.env.incoming
    const outgoing = c.env.outgoing

    const auth = c.req.header("authorization") ?? ""
    const bearer = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : undefined

    let ctx
    try {
      ctx = await authenticate(bearer)
    } catch (err) {
      const message = err instanceof ToolError ? err.message : "unauthorized"
      return c.json({ error: { code: "FORBIDDEN", message } }, 401)
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    const server = createMcpServer()
    await server.connect(transport)

    outgoing.on("close", () => {
      void transport.close()
      void server.close()
    })

    await runWithContext(ctx, async () => {
      await transport.handleRequest(incoming, outgoing)
    })
    return new Response(null)
  })

  serve({ fetch: app.fetch, port }, (info) => {
    log.info({ msg: "et-mcp http listening", port: info.port })
  })
}
