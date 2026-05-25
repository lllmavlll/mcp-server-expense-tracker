import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "./auth.js"

export const mcpApiKeys = pgTable("mcp_api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
})

export type McpApiKey = typeof mcpApiKeys.$inferSelect
export type NewMcpApiKey = typeof mcpApiKeys.$inferInsert
