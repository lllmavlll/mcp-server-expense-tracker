import { and, eq, isNull } from "drizzle-orm"
import { db, groups, groupMembers } from "../db/client.js"
import { getContext } from "../context.js"
import { loadGroupBalances } from "./_group-helpers.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {}

export const listGroups: ToolDef<typeof inputSchema> = {
  name: "list_groups",
  title: "List my groups",
  description:
    "List the groups you're an active member of, with your net balance in each " +
    "(positive = you are owed, negative = you owe). Excludes archived groups.",
  inputSchema,
  async handler() {
    const { userId } = getContext()
    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        currency: groups.currency,
        role: groupMembers.role,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(
        and(
          eq(groupMembers.userId, userId),
          eq(groupMembers.status, "active"),
          isNull(groups.archivedAt)
        )
      )

    const result = []
    for (const g of rows) {
      const { balances } = await loadGroupBalances(g.id)
      const mine = balances.find((b) => b.userId === userId)
      result.push({ ...g, myBalance: mine?.amount ?? "0.00" })
    }
    return jsonResult(result)
  },
}
