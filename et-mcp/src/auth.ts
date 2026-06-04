import { createHash } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { jwtVerify } from "jose"
import { db, mcpApiKeys, users } from "./db/client.js"
import { ToolError } from "./lib/errors.js"
import type { RequestContext } from "./context.js"

/** Audience claim required on internal JWTs minted by the expense-tracker app. */
const INTERNAL_JWT_AUDIENCE = "et-mcp"

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

/**
 * Resolve a bearer token to a request context. Two schemes:
 *
 * - `etmcp_...` API keys — external clients (Claude, Cursor, ...), hashed
 *   and looked up in mcp_api_keys.
 * - Signed HS256 JWTs — the expense-tracker app's in-app chat (service-to-
 *   service). Short-lived, identity-only (`sub` = userId, `aud` = "et-mcp"),
 *   verified against the shared MCP_INTERNAL_JWT_SECRET. User context
 *   (timezone/currency) is enriched from the DB, never trusted from claims.
 *
 * Throws ToolError(FORBIDDEN) for missing / malformed / unknown / revoked /
 * expired credentials.
 */
export async function authenticate(bearer: string | undefined): Promise<RequestContext> {
  if (!bearer) {
    throw new ToolError("FORBIDDEN", "missing bearer token")
  }
  if (bearer.startsWith("etmcp_")) {
    return authenticateApiKey(bearer)
  }
  // Three dot-separated base64url segments — shaped like a JWT.
  if (bearer.split(".").length === 3) {
    return authenticateInternalJwt(bearer)
  }
  throw new ToolError("FORBIDDEN", "missing or malformed api key")
}

async function authenticateApiKey(bearer: string): Promise<RequestContext> {
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

async function authenticateInternalJwt(token: string): Promise<RequestContext> {
  const secret = process.env.MCP_INTERNAL_JWT_SECRET
  if (!secret) {
    throw new ToolError("FORBIDDEN", "internal auth not configured")
  }

  let sub: string | undefined
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      audience: INTERNAL_JWT_AUDIENCE,
      algorithms: ["HS256"],
    })
    sub = payload.sub
  } catch {
    throw new ToolError("FORBIDDEN", "invalid or expired token")
  }
  if (!sub) throw new ToolError("FORBIDDEN", "token missing subject")

  const rows = await db
    .select({ userId: users.id, timezone: users.timezone, currency: users.currency })
    .from(users)
    .where(eq(users.id, sub))
    .limit(1)

  const row = rows[0]
  if (!row) throw new ToolError("FORBIDDEN", "unknown user")

  return {
    keyId: "internal-jwt",
    userId: row.userId,
    userTimezone: row.timezone,
    userCurrency: row.currency,
  }
}
