// ---------------------------------------------------------------------------
// Pure builder for a group expense + its splits.
//
// SHARED, CANONICAL SOURCE. Keep byte-identical between:
//   - expense-tracker/lib/money/group-expense.ts   (imports "./split")
//   - et-mcp/src/lib/money/group-expense.ts          (imports "./split.js")
// The ONLY allowed difference is the split import extension.
//
// This function does NO database I/O. Callers do: authz -> fetch group +
// active members -> buildGroupExpense(...) -> db.batch([...inserts]). Keeping
// the money/validation logic here (and out of the two route/tool layers) means
// the app and the MCP server can never disagree on how a bill is split.
// ---------------------------------------------------------------------------
import { toMinor, fromMinor, computeSplit, type SplitType, type Share } from "./split.js"

/** Thrown for bad user input (maps to HTTP 400 / MCP VALIDATION_ERROR). */
export class GroupExpenseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GroupExpenseError"
  }
}

export interface ParticipantInput {
  userId: string
  /** Required for "exact" splits: this person's decimal share. Ignored for "equal". */
  shareAmount?: string | number
  /**
   * Whether this person's share shows in THEIR personal metrics. Honored only
   * for the creator's own row (privacy: you can't opt someone else in) — see
   * the enforcement below.
   */
  reflectToPersonal?: boolean
}

export interface BuildGroupExpenseInput {
  /** Caller-generated UUID so split rows can reference the expense in one batch. */
  expenseId: string
  groupId: string
  currency: string
  /** Member who fronted the money. Must be an active member; need not be a participant. */
  paidBy: string
  /** Total bill amount (decimal). */
  amount: string | number
  category: string
  /** YYYY-MM-DD, already resolved (e.g. to today in the user's tz). */
  date: string
  description?: string | null
  splitType: SplitType
  /** Who the bill is split among. At least one; all must be active members. */
  participants: ParticipantInput[]
  /** Acting user (route/tool caller). */
  createdBy: string
  /** Active member userIds of the group, for membership validation. */
  activeMemberIds: Set<string>
}

export interface GroupExpenseRow {
  id: string
  groupId: string
  paidBy: string
  amount: string
  currency: string
  category: string
  description: string | null
  date: string
  splitType: SplitType
  createdBy: string
}

export interface GroupExpenseSplitRow {
  groupExpenseId: string
  userId: string
  shareAmount: string
  reflectToPersonal: boolean
}

export interface GroupActivityRow {
  groupId: string
  actorId: string
  type: "expense_added"
  payload: {
    expenseId: string
    amount: string
    paidBy: string
    splitType: SplitType
    participantCount: number
  }
}

export interface BuiltGroupExpense {
  expense: GroupExpenseRow
  splits: GroupExpenseSplitRow[]
  activity: GroupActivityRow
}

/**
 * Validate inputs and produce the exact rows to insert (expense + splits +
 * activity). Throws GroupExpenseError on any invalid input. Guarantees the
 * split shares sum exactly to the total.
 */
export function buildGroupExpense(input: BuildGroupExpenseInput): BuiltGroupExpense {
  const {
    expenseId,
    groupId,
    currency,
    paidBy,
    category,
    date,
    description,
    splitType,
    participants,
    createdBy,
    activeMemberIds,
  } = input

  const totalMinor = toMinor(input.amount)
  if (totalMinor <= 0) {
    throw new GroupExpenseError("amount must be greater than zero")
  }
  if (!category.trim()) {
    throw new GroupExpenseError("category is required")
  }
  if (!activeMemberIds.has(paidBy)) {
    throw new GroupExpenseError("payer is not an active member of this group")
  }
  if (participants.length === 0) {
    throw new GroupExpenseError("at least one participant is required")
  }

  // Reject duplicate participants and non-members up front.
  const seen = new Set<string>()
  for (const p of participants) {
    if (seen.has(p.userId)) {
      throw new GroupExpenseError(`participant ${p.userId} listed more than once`)
    }
    seen.add(p.userId)
    if (!activeMemberIds.has(p.userId)) {
      throw new GroupExpenseError(
        `participant ${p.userId} is not an active member of this group`
      )
    }
  }

  // Compute shares (in minor units) per split type.
  let shares: Share[]
  if (splitType === "equal") {
    // Order the payer first (when they're a participant) so they absorb the
    // sub-paise remainder — friendlier than a random member owing the extra.
    const ids = participants.map((p) => p.userId)
    const ordered = seen.has(paidBy)
      ? [paidBy, ...ids.filter((id) => id !== paidBy)]
      : ids
    shares = computeSplit({ type: "equal", totalMinor, participantIds: ordered })
  } else {
    const exactShares: Share[] = participants.map((p) => {
      if (p.shareAmount === undefined || p.shareAmount === null || p.shareAmount === "") {
        throw new GroupExpenseError(
          `exact split requires a shareAmount for participant ${p.userId}`
        )
      }
      return { userId: p.userId, shareMinor: toMinor(p.shareAmount) }
    })
    // computeSplit(exact) enforces sum === total and non-negative shares.
    shares = computeSplit({ type: "exact", totalMinor, shares: exactShares })
  }

  const reflectByUser = new Map(
    participants.map((p) => [p.userId, Boolean(p.reflectToPersonal)])
  )

  const splits: GroupExpenseSplitRow[] = shares.map((s) => ({
    groupExpenseId: expenseId,
    userId: s.userId,
    shareAmount: fromMinor(s.shareMinor),
    // Privacy: only the creator can opt their OWN share into personal metrics.
    // Everyone else defaults to false and toggles their own later.
    reflectToPersonal:
      s.userId === createdBy ? (reflectByUser.get(s.userId) ?? false) : false,
  }))

  const normalizedAmount = fromMinor(totalMinor)

  return {
    expense: {
      id: expenseId,
      groupId,
      paidBy,
      amount: normalizedAmount,
      currency,
      category: category.trim(),
      description: description?.trim() ? description.trim() : null,
      date,
      splitType,
      createdBy,
    },
    splits,
    activity: {
      groupId,
      actorId: createdBy,
      type: "expense_added",
      payload: {
        expenseId,
        amount: normalizedAmount,
        paidBy,
        splitType,
        participantCount: splits.length,
      },
    },
  }
}
