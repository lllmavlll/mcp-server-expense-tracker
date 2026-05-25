import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core"
import { users } from "./auth.js"

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const expenses = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  // Stored as string, not FK — keeps MCP usage simple
  category: varchar("category", { length: 100 }).notNull(),
  description: text("description"),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert

// Default categories seeded for every new user
export const DEFAULT_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: "Food", color: "#f59e0b" },
  { name: "Transport", color: "#3b82f6" },
  { name: "Shopping", color: "#a855f7" },
  { name: "Entertainment", color: "#ec4899" },
  { name: "Health", color: "#22c55e" },
  { name: "Utilities", color: "#eab308" },
  { name: "Other", color: "#6b7280" },
]
