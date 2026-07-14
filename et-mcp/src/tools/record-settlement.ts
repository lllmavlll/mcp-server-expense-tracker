import { z } from "zod"
import { db, settlements, groupActivity } from "../db/client.js"
import { getContext } from "../context.js"
import { ToolError } from "../lib/errors.js"
import { amount, isoDate, uuid } from "../lib/validation.js"
import { todayInTz } from "../lib/timezone.js"
import { assertGroupMember, activeMemberIds } from "./_group-helpers.js"
import { toMinor, fromMinor } from "../lib/money/split.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const inputSchema = {
  groupId: uuid.describe("The group the settlement belongs to."),
  toUserId: uuid.describe("Member who received the payment."),
  amount: amount.describe("Amount paid (decimal, up to 2 dp)."),
  fromUserId: uuid
    .optional()
    .describe("Member who paid. Defaults to you."),
  date: isoDate.optional().describe("YYYY-MM-DD; defaults to today in your timezone."),
  note: z.string().max(300).optional(),
}

export const recordSettlement: ToolDef<typeof inputSchema> = {
  name: "record_settlement",
  title: "Record a settlement (settle up)",
  description:
    "Record a real payment from one member to another to square up balances. " +
    "Defaults the payer to you. Both parties must be active members.",
  inputSchema,
  async handler({ groupId, toUserId, amount: amt, fromUserId, date, note }) {
    const { userId, userTimezone } = getContext()
    const { group } = await assertGroupMember(groupId)

    const from = fromUserId ?? userId
    if (from === toUserId) {
      throw new ToolError("VALIDATION_ERROR", "payer and receiver must differ")
    }
    const amountMinor = toMinor(amt)
    if (amountMinor <= 0) {
      throw new ToolError("VALIDATION_ERROR", "amount must be greater than zero")
    }
    const members = await activeMemberIds(groupId)
    if (!members.has(from) || !members.has(toUserId)) {
      throw new ToolError("VALIDATION_ERROR", "both parties must be active members")
    }

    const settlementId = crypto.randomUUID()
    const normalized = fromMinor(amountMinor)
    const useDate = date ?? todayInTz(userTimezone)
    await db.batch([
      db.insert(settlements).values({
        id: settlementId,
        groupId,
        fromUserId: from,
        toUserId,
        amount: normalized,
        currency: group.currency,
        date: useDate,
        note: note?.trim() || null,
        createdBy: userId,
      }),
      db.insert(groupActivity).values({
        groupId,
        actorId: userId,
        type: "settlement_added",
        payload: { settlementId, fromUserId: from, toUserId, amount: normalized },
      }),
    ])
    return jsonResult({
      id: settlementId,
      groupId,
      fromUserId: from,
      toUserId,
      amount: normalized,
      currency: group.currency,
      date: useDate,
    })
  },
}
