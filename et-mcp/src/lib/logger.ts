import { createHash } from "node:crypto"

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

function currentLevel(): number {
  const env = (process.env.LOG_LEVEL ?? "info") as Level
  return LEVELS[env] ?? LEVELS.info
}

export function userIdHash(userId: string | undefined): string {
  if (!userId) return "anon"
  return createHash("sha256").update(userId).digest("hex").slice(0, 8)
}

function emit(level: Level, fields: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel()) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields })
  // stderr so it never collides with stdio MCP JSON-RPC on stdout
  process.stderr.write(line + "\n")
}

export const log = {
  debug: (fields: Record<string, unknown>) => emit("debug", fields),
  info: (fields: Record<string, unknown>) => emit("info", fields),
  warn: (fields: Record<string, unknown>) => emit("warn", fields),
  error: (fields: Record<string, unknown>) => emit("error", fields),
}
