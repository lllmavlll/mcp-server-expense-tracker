import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "./auth.js"

// ---------------------------------------------------------------------------
// Groups + bill splitting (V2)
//
// This file MUST stay byte-identical to the app's lib/db/schema/groups.ts
// except for the "./auth.js" import extension. Both deployments share one DB.
//
// Design notes:
//  - Additive; nothing above changes.
//  - Balances are DERIVED at read time (see src/lib/money/split.ts).
//  - All money math is in integer minor units (paise). numeric(12,2) is the
//    storage format only — never float-divide these columns.
//  - Enum-like columns use varchar + a comment; allowed values enforced in code.
// ---------------------------------------------------------------------------

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  currency: varchar("currency", { length: 10 }).notNull().default("INR"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  archivedAt: timestamp("archived_at"),
})

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("group_members_group_user_uq").on(t.groupId, t.userId),
    index("group_members_user_idx").on(t.userId),
  ]
)

export const groupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    token: varchar("token", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    acceptedAt: timestamp("accepted_at"),
  },
  (t) => [
    uniqueIndex("group_invites_token_uq").on(t.token),
    uniqueIndex("group_invites_group_email_uq").on(t.groupId, t.email),
    index("group_invites_email_idx").on(t.email),
  ]
)

export const groupExpenses = pgTable(
  "group_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    paidBy: uuid("paid_by")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    description: text("description"),
    date: date("date").notNull(),
    splitType: varchar("split_type", { length: 20 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("group_expenses_group_idx").on(t.groupId),
    index("group_expenses_group_date_idx").on(t.groupId, t.date),
  ]
)

export const groupExpenseSplits = pgTable(
  "group_expense_splits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupExpenseId: uuid("group_expense_id")
      .notNull()
      .references(() => groupExpenses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    shareAmount: numeric("share_amount", { precision: 12, scale: 2 }).notNull(),
    reflectToPersonal: boolean("reflect_to_personal").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("group_expense_splits_expense_user_uq").on(
      t.groupExpenseId,
      t.userId
    ),
    index("group_expense_splits_user_idx").on(t.userId),
  ]
)

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    date: date("date").notNull(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("settlements_group_idx").on(t.groupId)]
)

export const groupActivity = pgTable(
  "group_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    type: varchar("type", { length: 40 }).notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("group_activity_group_idx").on(t.groupId)]
)

export type Group = typeof groups.$inferSelect
export type NewGroup = typeof groups.$inferInsert
export type GroupMember = typeof groupMembers.$inferSelect
export type NewGroupMember = typeof groupMembers.$inferInsert
export type GroupInvite = typeof groupInvites.$inferSelect
export type NewGroupInvite = typeof groupInvites.$inferInsert
export type GroupExpense = typeof groupExpenses.$inferSelect
export type NewGroupExpense = typeof groupExpenses.$inferInsert
export type GroupExpenseSplit = typeof groupExpenseSplits.$inferSelect
export type NewGroupExpenseSplit = typeof groupExpenseSplits.$inferInsert
export type Settlement = typeof settlements.$inferSelect
export type NewSettlement = typeof settlements.$inferInsert
export type GroupActivity = typeof groupActivity.$inferSelect
export type NewGroupActivity = typeof groupActivity.$inferInsert

export const GROUP_ROLES = ["owner", "admin", "member"] as const
export const MEMBER_STATUSES = ["active", "removed"] as const
export const INVITE_STATUSES = ["pending", "accepted", "revoked", "expired"] as const
export const SPLIT_TYPES = ["equal", "exact"] as const // "percentage", "shares" later
