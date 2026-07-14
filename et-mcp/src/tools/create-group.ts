import { z } from "zod"
import { db, groups, groupMembers, groupActivity } from "../db/client.js"
import { getContext } from "../context.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  name: z.string().trim().min(1).max(120).describe("Group name, e.g. 'Goa Trip'."),
  description: z.string().max(500).optional(),
  currency: z
    .string()
    .trim()
    .max(10)
    .optional()
    .describe("Group currency (ISO code). Defaults to your currency."),
}

export const createGroup: ToolDef<typeof inputSchema> = {
  name: "create_group",
  title: "Create a group",
  description:
    "Create a new group for shared/split expenses. You become its owner. " +
    "Returns the created group. Add members with add_group_member.",
  inputSchema,
  async handler({ name, description, currency }) {
    const { userId, userCurrency } = getContext()
    const groupId = crypto.randomUUID()
    const cur = currency?.trim() || userCurrency || "INR"
    await db.batch([
      db.insert(groups).values({
        id: groupId,
        name,
        description: description?.trim() || null,
        currency: cur,
        createdBy: userId,
      }),
      db.insert(groupMembers).values({ groupId, userId, role: "owner", status: "active" }),
      db.insert(groupActivity).values({
        groupId,
        actorId: userId,
        type: "group_created",
        payload: { name },
      }),
    ])
    return jsonResult({ id: groupId, name, currency: cur, role: "owner", memberCount: 1 })
  },
}
