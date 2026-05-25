import { createHash } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { db, mcpApiKeys, users } from "./db/client.js"
import { ToolError } from "./lib/errors.js"
import type { RequestContext } from "./context.js"

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

/**
 * Resolve a bearer token to a request context. Throws ToolError(FORBIDDEN)
 * for missing / malformed / unknown / revoked keys. Updates last_used_at
 * fire-and-forget so it doesn't add latency to tool calls.
 */
export async function authenticate(bearer: string | undefined): Promise<RequestContext> {
  if (!bearer || !bearer.startsWith("etmcp_")) {
    throw new ToolError("FORBIDDEN", "missing or malformed api key")
  }
  const hash = hashKey(bearer)
  const rows = await db
    .select({
      keyId: mcpApiKeys.id,
      revokedAt: mcpApiKeys.revokedAt,
      userId: users.id,
      timezone: users.timezone,
      currency: users.currency,
    })
    .from(mcpApiKeys)
    .innerJoin(users, eq(users.id, mcpApiKeys.userId))
    .where(and(eq(mcpApiKeys.keyHash, hash), isNull(mcpApiKeys.revokedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) throw new ToolError("FORBIDDEN", "invalid or revoked api key")

  // fire-and-forget last_used_at update
  void db
    .update(mcpApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpApiKeys.id, row.keyId))
    .catch(() => {})

  return {
    keyId: row.keyId,
    userId: row.userId,
    userTimezone: row.timezone,
    userCurrency: row.currency,
  }
}
