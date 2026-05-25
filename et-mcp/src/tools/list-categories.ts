import { asc, eq } from "drizzle-orm"
import { categories, db } from "../db/client.js"
import { getContext } from "../context.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {}

export const listCategories: ToolDef<typeof inputSchema> = {
  name: "list_categories",
  title: "List the user's categories",
  description:
    "Return all categories belonging to the authenticated user (id, name, color, isDefault). " +
    "No inputs.",
  inputSchema,
  async handler() {
    const { userId } = getContext()
    const rows = await db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.name))
    return jsonResult(rows)
  },
}
