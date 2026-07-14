import { and, eq } from "drizzle-orm"
import { db, users, groupMembers } from "../db/client.js"
import { uuid } from "../lib/validation.js"
import { assertGroupMember, loadGroupBalances } from "./_group-helpers.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  groupId: uuid.describe("The group to inspect. You must be an active member."),
}

export const getGroup: ToolDef<typeof inputSchema> = {
  name: "get_group",
  title: "Get group details",
  description:
    "Get a group's members and current balances (net per member + simplified " +
    "'who owes whom' suggestions). You must be an active member.",
  inputSchema,
  async handler({ groupId }) {
    const { group } = await assertGroupMember(groupId)

    const members = await db
      .select({
        userId: groupMembers.userId,
        role: groupMembers.role,
        name: users.name,
        email: users.email,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")))

    const { balances, transfers } = await loadGroupBalances(groupId)
    const nameOf = new Map(members.map((m) => [m.userId, m.name ?? m.email]))

    return jsonResult({
      id: group.id,
      name: group.name,
      currency: group.currency,
      members,
      balances: balances.map((b) => ({ ...b, name: nameOf.get(b.userId) ?? null })),
      transfers: transfers.map((t) => ({
        ...t,
        fromName: nameOf.get(t.fromUserId) ?? null,
        toName: nameOf.get(t.toUserId) ?? null,
      })),
    })
  },
}
