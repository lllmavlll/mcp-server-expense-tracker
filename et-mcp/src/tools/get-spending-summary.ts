import { z } from "zod"
import { and, eq, gte, lte, sql } from "drizzle-orm"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { isoDate } from "../lib/validation.js"
import { todayInTz } from "../lib/timezone.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  period: z.enum(["week", "month", "year"])
    .describe("Window relative to anchor_date (default: today in user's tz)."),
  anchor_date: isoDate.optional()
    .describe("YYYY-MM-DD; defaults to today in the user's timezone."),
}

function rangeFor(period: "week" | "month" | "year", anchor: string): {
  from: string
  to: string
} {
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number]
  const base = new Date(Date.UTC(y, m - 1, d))
  let from: Date
  let to: Date
  if (period === "week") {
    // ISO week: Monday..Sunday
    const dow = (base.getUTCDay() + 6) % 7 // Mon=0..Sun=6
    from = new Date(base)
    from.setUTCDate(base.getUTCDate() - dow)
    to = new Date(from)
    to.setUTCDate(from.getUTCDate() + 6)
  } else if (period === "month") {
    from = new Date(Date.UTC(y, m - 1, 1))
    to = new Date(Date.UTC(y, m, 0))
  } else {
    from = new Date(Date.UTC(y, 0, 1))
    to = new Date(Date.UTC(y, 11, 31))
  }
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

export const getSpendingSummary: ToolDef<typeof inputSchema> = {
  name: "get_spending_summary",
  title: "Spending summary for a period",
  description:
    "Summarize spending over a window (week | month | year) relative to anchor_date " +
    "(defaults to today in the user's timezone). " +
    "Returns { period, from, to, total, count, by_category: [{category,total,count}] }.",
  inputSchema,
  async handler({ period, anchor_date }) {
    const { userId, userTimezone } = getContext()
    const anchor = anchor_date ?? todayInTz(userTimezone)
    const { from, to } = rangeFor(period, anchor)

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

    const total = rows.reduce((s, r) => s + Number(r.total), 0).toFixed(2)
    const count = rows.reduce((s, r) => s + r.count, 0)

    return jsonResult({
      period,
      from,
      to,
      total,
      count,
      by_category: rows.map((r) => ({
        category: r.category,
        total: Number(r.total).toFixed(2),
        count: r.count,
      })),
    })
  },
}
