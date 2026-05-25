import "dotenv/config"
import { startHttp } from "./transports/http.js"
import { startStdio } from "./transports/stdio.js"
import { log } from "./lib/logger.js"

async function main(): Promise<void> {
  const transport = (process.env.MCP_TRANSPORT ?? "http").toLowerCase()
  if (transport === "stdio") {
    await startStdio()
    return
  }
  if (transport !== "http") {
    throw new Error(`unknown MCP_TRANSPORT: ${transport} (expected 'http' or 'stdio')`)
  }
  const port = Number(process.env.PORT ?? 3001)
  await startHttp(port)
}

main().catch((err) => {
  log.error({ msg: "fatal", error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
