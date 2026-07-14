import { z } from "zod"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db, groupExpenses, groupExpenseSplits } from "../db/client.js"
import { uuid } from "../lib/validation.js"
import { assertGroupMember } from "./_group-helpers.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  groupId: uuid.describe("The group whose bills to list."),
  limit: z.number().int().min(1).max(200).optional().describe("Max bills (default 50)."),
}

export const listGroupExpenses: ToolDef<typeof inputSchema> = {
  name: "list_group_expenses",
  title: "List group expenses",
  description:
    "List a group's shared bills (newest first) with their per-member splits. " +
    "Excludes deleted bills. You must be an active member.",
  inputSchema,
  async handler({ groupId, limit }) {
    await assertGroupMember(groupId)

    const rows = await db
      .select()
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
      .orderBy(desc(groupExpenses.date), desc(groupExpenses.createdAt))
      .limit(limit ?? 50)

    const ids = rows.map((r) => r.id)
    const splits = ids.length
      ? await db
          .select()
          .from(groupExpenseSplits)
          .where(inArray(groupExpenseSplits.groupExpenseId, ids))
      : []
    const byExpense = new Map<string, typeof splits>()
    for (const s of splits) {
      const list = byExpense.get(s.groupExpenseId) ?? []
      list.push(s)
      byExpense.set(s.groupExpenseId, list)
    }

    return jsonResult(rows.map((r) => ({ ...r, splits: byExpense.get(r.id) ?? [] })))
  },
}
