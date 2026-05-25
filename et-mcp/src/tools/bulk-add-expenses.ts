import { z } from "zod"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { amount, categoryName, isoDate } from "../lib/validation.js"
import { todayInTz } from "../lib/timezone.js"
import { ensureCategory, jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const item = z.object({
  amount,
  category: categoryName,
  date: isoDate.optional(),
  description: z.string().max(500).optional(),
})

const inputSchema = {
  expenses: z.array(item).min(1).max(100)
    .describe("Array of expenses (1-100). Same per-item rules as add_expense."),
}

export const bulkAddExpenses: ToolDef<typeof inputSchema> = {
  name: "bulk_add_expenses",
  title: "Add multiple expenses",
  description:
    "Insert up to 100 expenses in a single call. " +
    "Each item: amount (decimal), category (auto-created), optional date (YYYY-MM-DD, defaults to today in user's tz), optional description. " +
    "Returns { created: number, rows: Expense[] }.",
  inputSchema,
  async handler({ expenses: items }) {
    const { userId, userTimezone } = getContext()
    const today = todayInTz(userTimezone)

    // Auto-create distinct categories once
    const distinctCats = [...new Set(items.map((i) => i.category))]
    await Promise.all(distinctCats.map((c) => ensureCategory(c)))

    const values = items.map((i) => ({
      userId,
      amount: i.amount,
      category: i.category,
      date: i.date ?? today,
      description: i.description ?? null,
    }))

    const rows = await db.insert(expenses).values(values).returning()
    return jsonResult({ created: rows.length, rows })
  },
}
