import { and, desc, eq, gte, lte, sql } from "drizzle-orm"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { isoDate } from "../lib/validation.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  from: isoDate.describe("Inclusive start date YYYY-MM-DD."),
  to: isoDate.describe("Inclusive end date YYYY-MM-DD."),
}

export const getExpensesByCategory: ToolDef<typeof inputSchema> = {
  name: "get_expenses_by_category",
  title: "Category breakdown for a date range",
  description:
    "Return totals grouped by category for the authenticated user, between from..to (inclusive, YYYY-MM-DD). " +
    "Returns [{ category, total, count }] ordered by total desc.",
  inputSchema,
  async handler({ from, to }) {
    const { userId } = getContext()
    const rows = await db
      .select({
        category: expenses.category,
        total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`.as("total"),
        count: sql<number>`COUNT(*)::int`.as("count"),
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, userId),
          gte(expenses.date, from),
          lte(expenses.date, to),
        ),
      )
      .groupBy(expenses.category)
      .orderBy(desc(sql`total`))

    return jsonResult(
      rows.map((r) => ({
        category: r.category,
        total: Number(r.total).toFixed(2),
        count: r.count,
      })),
    )
  },
}
