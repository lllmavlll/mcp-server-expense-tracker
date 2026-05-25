import { and, eq } from "drizzle-orm"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { uuid } from "../lib/validation.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = { id: uuid }

export const getExpenseById: ToolDef<typeof inputSchema> = {
  name: "get_expense_by_id",
  title: "Get a single expense",
  description:
    "Fetch a single expense by id, scoped to the authenticated user. " +
    "Returns the row, or null if not found (does not distinguish 'not yours' from 'doesn't exist').",
  inputSchema,
  async handler({ id }) {
    const { userId } = getContext()
    const [row] = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
      .limit(1)
    return jsonResult(row ?? null)
  },
}
