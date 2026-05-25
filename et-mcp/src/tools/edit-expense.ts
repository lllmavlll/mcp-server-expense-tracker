import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { ToolError } from "../lib/errors.js"
import { amount, categoryName, isoDate, uuid } from "../lib/validation.js"
import { ensureCategory, jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  id: uuid.describe("Expense id to edit."),
  amount: amount.optional(),
  category: categoryName.optional().describe("Category name; auto-created if new."),
  date: isoDate.optional(),
  description: z.string().max(500).nullable().optional()
    .describe("Pass null to clear, omit to leave unchanged."),
}

export const editExpense: ToolDef<typeof inputSchema> = {
  name: "edit_expense",
  title: "Edit an expense",
  description:
    "Update fields on an existing expense owned by the authenticated user. " +
    "All fields except id are optional; pass only what changes. " +
    "Pass description=null to clear it. Returns the updated row, or NOT_FOUND.",
  inputSchema,
  async handler({ id, amount: amt, category, date, description }) {
    const { userId } = getContext()
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (amt !== undefined) patch.amount = amt
    if (date !== undefined) patch.date = date
    if (description !== undefined) patch.description = description
    if (category !== undefined) {
      await ensureCategory(category)
      patch.category = category
    }

    const [row] = await db
      .update(expenses)
      .set(patch)
      .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
      .returning()

    if (!row) throw new ToolError("NOT_FOUND", "expense not found")
    return jsonResult(row)
  },
}
