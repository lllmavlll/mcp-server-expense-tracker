import { z } from "zod"
import { db, groupExpenses, groupExpenseSplits, groupActivity } from "../db/client.js"
import { getContext } from "../context.js"
import { ToolError } from "../lib/errors.js"
import { amount, categoryName, isoDate, uuid } from "../lib/validation.js"
import { todayInTz } from "../lib/timezone.js"
import { assertGroupMember, activeMemberIds } from "./_group-helpers.js"
import {
  buildGroupExpense,
  GroupExpenseError,
  type ParticipantInput,
} from "../lib/money/group-expense.js"
import { jsonResult } from "./_helpers.js"
import type { ToolDef } from "./types.js"

const participant = z.object({
  userId: uuid.describe("Group member this share belongs to."),
  shareAmount: amount
    .optional()
    .describe("Required for splitType 'exact': this member's exact share. Ignored for 'equal'."),
  reflectToPersonal: z
    .boolean()
    .optional()
    .describe(
      "Only honored for YOUR own share — mirrors it into your personal metrics. Cannot be set for others."
    ),
})

const inputSchema = {
  groupId: uuid.describe("The group to add the bill to. You must be an active member."),
  amount: amount.describe("Total bill amount (decimal, up to 2 dp)."),
  category: categoryName.describe("Category name for the bill, e.g. 'Food'."),
  splitType: z
    .enum(["equal", "exact"])
    .describe("'equal' splits evenly among participants; 'exact' uses each participant's shareAmount."),
  participants: z
    .array(participant)
    .min(1)
    .describe("Members the bill is split among. For 'exact', each needs a shareAmount summing to the total."),
  paidBy: uuid
    .optional()
    .describe("Member who paid. Defaults to you. Must be an active member; need not be a participant."),
  date: isoDate.optional().describe("YYYY-MM-DD; defaults to today in your timezone."),
  description: z.string().max(500).optional(),
}

export const addGroupExpense: ToolDef<typeof inputSchema> = {
  name: "add_group_expense",
  title: "Add a group expense (split bill)",
  description:
    "Add a shared bill to a group and split it among selected members. " +
    "splitType 'equal' divides evenly (sub-paise remainder absorbed by the payer); " +
    "'exact' requires a shareAmount per participant that sums exactly to the total. " +
    "The bill's currency is the group's currency. Returns the created expense with its splits.",
  inputSchema,
  async handler({ groupId, amount: amt, category, splitType, participants, paidBy, date, description }) {
    const { userId, userTimezone } = getContext()

    // Authz: must be an active member of the group.
    const { group } = await assertGroupMember(groupId)
    const members = await activeMemberIds(groupId)

    let built
    try {
      built = buildGroupExpense({
        expenseId: crypto.randomUUID(),
        groupId,
        currency: group.currency,
        paidBy: paidBy ?? userId,
        amount: amt,
        category,
        date: date ?? todayInTz(userTimezone),
        description: description ?? null,
        splitType,
        participants: participants as ParticipantInput[],
        createdBy: userId,
        activeMemberIds: members,
      })
    } catch (err) {
      if (err instanceof GroupExpenseError) {
        throw new ToolError("VALIDATION_ERROR", err.message)
      }
      throw err
    }

    // Atomic: db.batch runs the array as one server-side transaction on neon-http.
    await db.batch([
      db.insert(groupExpenses).values(built.expense),
      db.insert(groupExpenseSplits).values(built.splits),
      db.insert(groupActivity).values(built.activity),
    ])

    return jsonResult({ ...built.expense, splits: built.splits })
  },
}
