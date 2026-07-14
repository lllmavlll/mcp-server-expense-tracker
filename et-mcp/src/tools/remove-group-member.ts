import { and, eq } from "drizzle-orm"
import { db, groupMembers, groupActivity } from "../db/client.js"
import { getContext } from "../context.js"
import { ToolError } from "../lib/errors.js"
import { uuid } from "../lib/validation.js"
import { assertGroupMember, loadGroupBalances } from "./_group-helpers.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  groupId: uuid.describe("The group to remove someone from."),
  userId: uuid.describe("The member to remove. Use your own id to leave."),
}

export const removeGroupMember: ToolDef<typeof inputSchema> = {
  name: "remove_group_member",
  title: "Remove a group member",
  description:
    "Remove a member from a group (or leave, using your own id). Removing " +
    "someone else requires owner/admin. Blocked if the member has a non-zero " +
    "balance (settle up first). The owner can't be removed here.",
  inputSchema,
  async handler({ groupId, userId: targetId }) {
    const { userId } = getContext()
    const { membership } = await assertGroupMember(groupId)

    const isSelf = targetId === userId
    if (!isSelf && membership.role !== "owner" && membership.role !== "admin") {
      throw new ToolError("FORBIDDEN", "only an owner/admin can remove other members")
    }

    const [target] = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, targetId),
          eq(groupMembers.status, "active")
        )
      )
      .limit(1)
    if (!target) throw new ToolError("NOT_FOUND", "member not found")
    if (target.role === "owner") {
      throw new ToolError("VALIDATION_ERROR", "the owner cannot be removed")
    }

    const { net } = await loadGroupBalances(groupId)
    if ((net.get(targetId) ?? 0) !== 0) {
      throw new ToolError(
        "VALIDATION_ERROR",
        "member has a non-zero balance; settle up before removing"
      )
    }

    await db.batch([
      db.update(groupMembers).set({ status: "removed" }).where(eq(groupMembers.id, target.id)),
      db.insert(groupActivity).values({
        groupId,
        actorId: userId,
        type: "member_removed",
        payload: { userId: targetId, self: isSelf },
      }),
    ])
    return jsonResult({ removed: targetId })
  },
}
