import { AsyncLocalStorage } from "node:async_hooks"
import { ToolError } from "./lib/errors.js"

export interface RequestContext {
  userId: string
  userTimezone: string
  userCurrency: string
  keyId: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(ctx, fn)
}

export function getContext(): RequestContext {
  const ctx = storage.getStore()
  if (!ctx) throw new ToolError("FORBIDDEN", "no authenticated context")
  return ctx
}
