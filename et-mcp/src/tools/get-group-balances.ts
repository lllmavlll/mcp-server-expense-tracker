import { and, eq } from "drizzle-orm"
import { db, users, groupMembers } from "../db/client.js"
import { uuid } from "../lib/validation.js"
import { assertGroupMember, loadGroupBalances } from "./_group-helpers.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  groupId: uuid.describe("The group to get balances for."),
}

export const getGroupBalances: ToolDef<typeof inputSchema> = {
  name: "get_group_balances",
  title: "Get group balances",
  description:
    "Get net balances per member (positive = owed to them, negative = they owe) " +
    "plus simplified 'who pays whom' settlement suggestions. You must be a member.",
  inputSchema,
  async handler({ groupId }) {
    const { group } = await assertGroupMember(groupId)
    const { balances, transfers } = await loadGroupBalances(groupId)

    const memberRows = await db
      .select({ userId: groupMembers.userId, name: users.name, email: users.email })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")))
    const nameOf = new Map(memberRows.map((m) => [m.userId, m.name ?? m.email]))

    return jsonResult({
      currency: group.currency,
      balances: balances.map((b) => ({ ...b, name: nameOf.get(b.userId) ?? null })),
      transfers: transfers.map((t) => ({
        ...t,
        fromName: nameOf.get(t.fromUserId) ?? null,
        toName: nameOf.get(t.toUserId) ?? null,
      })),
    })
  },
}
