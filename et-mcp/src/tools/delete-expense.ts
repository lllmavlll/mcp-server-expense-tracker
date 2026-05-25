import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { ToolError } from "../lib/errors.js"
import { uuid } from "../lib/validation.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  id: uuid,
  confirm: z.boolean()
    .describe("Must be true. Without it, this tool returns CONFIRMATION_REQUIRED."),
}

export const deleteExpense: ToolDef<typeof inputSchema> = {
  name: "delete_expense",
  title: "Delete an expense",
  description:
    "Permanently delete one expense owned by the authenticated user. " +
    "Requires confirm: true — without it, returns CONFIRMATION_REQUIRED so the model re-prompts the user. " +
    "Returns { deleted: true, id } on success, or NOT_FOUND.",
  inputSchema,
  async handler({ id, confirm }) {
    if (!confirm) {
      throw new ToolError(
        "CONFIRMATION_REQUIRED",
        "set confirm: true to permanently delete this expense",
      )
    }
    const { userId } = getContext()
    const [row] = await db
      .delete(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
      .returning({ id: expenses.id })
    if (!row) throw new ToolError("NOT_FOUND", "expense not found")
    return jsonResult({ deleted: true, id: row.id })
  },
}
