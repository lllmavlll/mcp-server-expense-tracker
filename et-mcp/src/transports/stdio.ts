import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { authenticate } from "../auth.js"
import { runWithContext, type RequestContext } from "../context.js"
import { log } from "../lib/logger.js"
import { createMcpServer } from "../server.js"

/**
 * stdio transport: the API key comes from MCP_API_KEY env var (the user's
 * MCP client config injects it). We authenticate once at startup, then every
 * tool call runs inside the same AsyncLocalStorage frame.
 */
export async function startStdio(): Promise<void> {
  const key = process.env.MCP_API_KEY
  if (!key) {
    console.error("MCP_API_KEY is required for stdio transport")
    process.exit(1)
  }

  let ctx: RequestContext
  try {
    ctx = await authenticate(key)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`auth failed: ${message}`)
    process.exit(1)
  }

  const server = createMcpServer()
  const transport = new StdioServerTransport()

  // Run the entire stdio session inside the auth context.
  await runWithContext(ctx, async () => {
    await server.connect(transport)
    log.info({ msg: "et-mcp stdio connected" })
    await new Promise<void>((resolve) => {
      const shutdown = () => resolve()
      process.on("SIGINT", shutdown)
      process.on("SIGTERM", shutdown)
      transport.onclose = shutdown
    })
  })
}
