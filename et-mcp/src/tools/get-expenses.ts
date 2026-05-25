import { z } from "zod"
import { and, asc, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm"
import { db, expenses } from "../db/client.js"
import { getContext } from "../context.js"
import { categoryName, isoDate } from "../lib/validation.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  search: z.string().trim().min(1).max(200).optional()
    .describe("Substring match against description or category (case-insensitive)."),
  category: categoryName.optional().describe("Exact category name filter."),
  from: isoDate.optional().describe("Inclusive lower bound on date (YYYY-MM-DD)."),
  to: isoDate.optional().describe("Inclusive upper bound on date (YYYY-MM-DD)."),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  order: z.enum(["asc", "desc"]).default("desc")
    .describe("Order by date; default newest first."),
}

export const getExpenses: ToolDef<typeof inputSchema> = {
  name: "get_expenses",
  title: "List expenses (filtered)",
  description:
    "List the authenticated user's expenses. " +
    "Optional filters: search (matches description or category), category (exact), from/to (YYYY-MM-DD inclusive), limit (default 50, max 500), offset, order (asc|desc, default desc). " +
    "Returns an array of expense rows.",
  inputSchema,
  async handler({ search, category, from, to, limit, offset, order }) {
    const { userId } = getContext()
    const filters: SQL[] = [eq(expenses.userId, userId)]
    if (category) filters.push(eq(expenses.category, category))
    if (from) filters.push(gte(expenses.date, from))
    if (to) filters.push(lte(expenses.date, to))
    if (search) {
      const like = `%${search}%`
      const match = or(ilike(expenses.description, like), ilike(expenses.category, like))
      if (match) filters.push(match)
    }
    const rows = await db
      .select()
      .from(expenses)
      .where(and(...filters))
      .orderBy(order === "asc" ? asc(expenses.date) : desc(expenses.date))
      .limit(limit)
      .offset(offset)
    return jsonResult(rows)
  },
}
