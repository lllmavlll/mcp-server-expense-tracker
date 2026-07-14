import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as authSchema from "./schema/auth.js"
import * as expensesSchema from "./schema/expenses.js"
import * as mcpSchema from "./schema/mcp.js"
import * as groupsSchema from "./schema/groups.js"

const schema = { ...authSchema, ...expensesSchema, ...mcpSchema, ...groupsSchema }
type DbInstance = ReturnType<typeof drizzle<typeof schema>>

let _instance: DbInstance | undefined

export function getDb(): DbInstance {
  if (!_instance) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set")
    _instance = drizzle(neon(url), { schema })
  }
  return _instance
}

export const db = new Proxy({} as DbInstance, {
  get(_, prop) {
    const instance = getDb()
    const value = (instance as unknown as Record<string | symbol, unknown>)[prop]
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(instance)
    }
    return value
  },
}) as DbInstance

export * from "./schema/auth.js"
export * from "./schema/expenses.js"
export * from "./schema/mcp.js"
export * from "./schema/groups.js"
