import { z } from "zod"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { amount, categoryName, isoDate } from "../lib/validation.js"
import { todayInTz } from "../lib/timezone.js"
import { ensureCategory, jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  amount: amount.describe("Decimal string or number with up to 2 fractional digits."),
  category: categoryName.describe("Category name. Created on the fly if it doesn't exist."),
  date: isoDate.optional().describe("YYYY-MM-DD; defaults to today in the user's timezone."),
  description: z.string().max(500).optional(),
}

export const addExpense: ToolDef<typeof inputSchema> = {
  name: "add_expense",
  title: "Add an expense",
  description:
    "Add a single expense for the authenticated user. " +
    "Inputs: amount (decimal), category (string, auto-created), optional date (YYYY-MM-DD; defaults to today in user's tz), optional description. " +
    "Returns the created expense row.",
  inputSchema,
  async handler({ amount: amt, category, date, description }) {
    const { userId, userTimezone } = getContext()
    await ensureCategory(category)
    const useDate = date ?? todayInTz(userTimezone)
    const [row] = await db
      .insert(expenses)
      .values({
        userId,
        amount: amt,
        category,
        date: useDate,
        description: description ?? null,
      })
      .returning()
    return jsonResult(row)
  },
}
