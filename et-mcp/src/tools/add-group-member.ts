import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { db, users, groupMembers, groupInvites, groupActivity } from "../db/client.js"
import { getContext } from "../context.js"
import { uuid } from "../lib/validation.js"
import { assertGroupMember } from "./_group-helpers.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

const inputSchema = {
  groupId: uuid.describe("The group to add someone to."),
  email: z.string().email().describe("Email of the person to add."),
}

export const addGroupMember: ToolDef<typeof inputSchema> = {
  name: "add_group_member",
  title: "Add a group member",
  description:
    "Add someone to a group by email. If they already have an account they're " +
    "added immediately; otherwise a pending invite is created and they join " +
    "automatically when they sign up. Returns whether a member or invite was created.",
  inputSchema,
  async handler({ groupId, email }) {
    const { userId } = getContext()
    await assertGroupMember(groupId)
    const normalized = email.trim().toLowerCase()

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1)

    if (existingUser) {
      const [membership] = await db
        .select()
        .from(groupMembers)
        .where(
          and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, existingUser.id))
        )
        .limit(1)
      if (membership?.status === "active") {
        return jsonResult({ type: "member", userId: existingUser.id, alreadyMember: true })
      }
      if (membership) {
        await db
          .update(groupMembers)
          .set({ status: "active", role: "member", joinedAt: new Date() })
          .where(eq(groupMembers.id, membership.id))
      } else {
        await db
          .insert(groupMembers)
          .values({ groupId, userId: existingUser.id, role: "member", status: "active" })
      }
      await db.insert(groupActivity).values({
        groupId,
        actorId: userId,
        type: "member_added",
        payload: { userId: existingUser.id, email: normalized },
      })
      return jsonResult({ type: "member", userId: existingUser.id, email: normalized })
    }

    const [pending] = await db
      .select({ id: groupInvites.id })
      .from(groupInvites)
      .where(
        and(
          eq(groupInvites.groupId, groupId),
          eq(groupInvites.email, normalized),
          eq(groupInvites.status, "pending")
        )
      )
      .limit(1)
    if (pending) return jsonResult({ type: "invite", email: normalized, reused: true })

    await db.batch([
      db.insert(groupInvites).values({
        groupId,
        email: normalized,
        invitedBy: userId,
        role: "member",
        token: crypto.randomUUID(),
        status: "pending",
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      }),
      db.insert(groupActivity).values({
        groupId,
        actorId: userId,
        type: "invite_sent",
        payload: { email: normalized },
      }),
    ])
    return jsonResult({ type: "invite", email: normalized })
  },
}
