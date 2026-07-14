import { and, eq, isNull, inArray } from "drizzle-orm"
import {
  db,
  groups,
  groupMembers,
  groupExpenses,
  groupExpenseSplits,
  settlements,
  type Group,
  type GroupMember,
} from "../db/client.js"
import { getContext } from "../context.js"
import { ToolError } from "../lib/errors.js"
import { toMinor, computeBalances, serializeBalances } from "../lib/money/split.js"

/**
 * Assert the authenticated user is an ACTIVE member of a non-archived group.
 * Returns the group (for its currency) and the membership (for the role).
 * Throws NOT_FOUND for both missing groups and non-membership — never reveal a
 * group's existence to someone who isn't in it.
 */
export async function assertGroupMember(
  groupId: string
): Promise<{ group: Group; membership: GroupMember }> {
  const { userId } = getContext()

  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), isNull(groups.archivedAt)))
    .limit(1)
  if (!group) throw new ToolError("NOT_FOUND", "group not found")

  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, "active")
      )
    )
    .limit(1)
  if (!membership) throw new ToolError("NOT_FOUND", "group not found")

  return { group, membership }
}

/** Active member userIds of a group — used to validate expense participants. */
export async function activeMemberIds(groupId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")))
  return new Set(rows.map((r) => r.userId))
}

/**
 * Derived balances (net per member) + simplified settlement suggestions for a
 * group. Mirrors the app's loadGroupBalances; excludes soft-deleted rows and
 * does all math in integer minor units via the shared money module.
 */
export async function loadGroupBalances(groupId: string) {
  const [expenseRows, memberRows, settlementRows] = await Promise.all([
    db
      .select({
        id: groupExpenses.id,
        paidBy: groupExpenses.paidBy,
        amount: groupExpenses.amount,
      })
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt))),
    db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active"))),
    db
      .select({
        fromUserId: settlements.fromUserId,
        toUserId: settlements.toUserId,
        amount: settlements.amount,
      })
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt))),
  ])

  const expenseIds = expenseRows.map((e) => e.id)
  const splitRows = expenseIds.length
    ? await db
        .select({
          groupExpenseId: groupExpenseSplits.groupExpenseId,
          userId: groupExpenseSplits.userId,
          shareAmount: groupExpenseSplits.shareAmount,
        })
        .from(groupExpenseSplits)
        .where(inArray(groupExpenseSplits.groupExpenseId, expenseIds))
    : []

  const splitsByExpense = new Map<string, { userId: string; shareMinor: number }[]>()
  for (const s of splitRows) {
    const list = splitsByExpense.get(s.groupExpenseId) ?? []
    list.push({ userId: s.userId, shareMinor: toMinor(s.shareAmount) })
    splitsByExpense.set(s.groupExpenseId, list)
  }

  const net = computeBalances({
    expenses: expenseRows.map((e) => ({
      paidBy: e.paidBy,
      amountMinor: toMinor(e.amount),
      splits: splitsByExpense.get(e.id) ?? [],
    })),
    settlements: settlementRows.map((s) => ({
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      amountMinor: toMinor(s.amount),
    })),
  })

  const order = memberRows.map((m) => m.userId).sort()
  for (const id of order) if (!net.has(id)) net.set(id, 0)

  return { net, ...serializeBalances(net, order) }
}
