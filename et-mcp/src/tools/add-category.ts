import { and, eq } from "drizzle-orm"
import { categories, db } from "../db/client.js"
import { getContext } from "../context.js"
import { ToolError } from "../lib/errors.js"
import { categoryName, hexColor } from "../lib/validation.js"
import { colorForCategory } from "../lib/category-color.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  name: categoryName,
  color: hexColor.optional().describe("Hex #RRGGBB; defaults to a deterministic palette pick."),
}

export const addCategory: ToolDef<typeof inputSchema> = {
  name: "add_category",
  title: "Create a custom category",
  description:
    "Create a new category for the authenticated user. " +
    "Inputs: name (string), optional color (#RRGGBB; defaults to a deterministic palette pick). " +
    "Returns the created row, or VALIDATION_ERROR if the name already exists.",
  inputSchema,
  async handler({ name, color }) {
    const { userId } = getContext()
    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.name, name)))
      .limit(1)
    if (existing.length > 0) {
      throw new ToolError("VALIDATION_ERROR", `category "${name}" already exists`)
    }
    const [row] = await db
      .insert(categories)
      .values({
        userId,
        name,
        color: color ?? colorForCategory(name),
        isDefault: false,
      })
      .returning()
    return jsonResult(row)
  },
}
