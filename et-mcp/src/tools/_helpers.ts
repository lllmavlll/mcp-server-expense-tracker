import { and, eq } from "drizzle-orm"
import { categories, db } from "../db/client.js"
import { getContext } from "../context.js"
import { colorForCategory } from "../lib/category-color.js"

/** Ensure (user, category) exists in `categories`. Idempotent. */
export async function ensureCategory(name: string): Promise<void> {
  const { userId } = getContext()
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name)))
    .limit(1)
  if (existing.length > 0) return
  try {
    await db.insert(categories).values({
      userId,
      name,
      color: colorForCategory(name),
      isDefault: false,
    })
  } catch {
    // race: another concurrent insert created it; ignore.
  }
}

/** JSON tool result wrapper. */
export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  }
}
