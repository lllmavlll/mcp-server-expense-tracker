// ---------------------------------------------------------------------------
// Money math for groups + bill splitting.
//
// SHARED, CANONICAL SOURCE. This file is dependency-free and MUST stay
// byte-identical between:
//   - expense-tracker/lib/money/split.ts   (the app)
//   - et-mcp/src/lib/money/split.ts         (the MCP server)
// Two independent implementations of split/rounding would drift and produce
// balances that don't reconcile. Keep them in sync (ideally promote to a
// shared package later).
//
// GOLDEN RULE: do every calculation in integer MINOR units (paise/cents).
// Never float-divide a decimal amount. Storage is numeric(12,2); parse to
// minor units at the boundary with toMinor(), format back with fromMinor().
// ---------------------------------------------------------------------------

export type SplitType = "equal" | "exact"

export interface Share {
  userId: string
  /** Integer minor units (paise) this user owes for one bill. */
  shareMinor: number
}

export interface Transfer {
  fromUserId: string
  toUserId: string
  /** Integer minor units to move. Always positive. */
  amountMinor: number
}

const DECIMAL_RE = /^-?\d+(\.\d{1,2})?$/

/**
 * Parse a decimal money string/number into integer minor units.
 * Rejects anything with >2 fractional digits. Strings are preferred; a number
 * is stringified via toFixed(2) first (fine for typical amounts).
 */
export function toMinor(amount: string | number): number {
  const s = typeof amount === "number" ? amount.toFixed(2) : amount.trim()
  if (!DECIMAL_RE.test(s)) {
    throw new Error(`invalid money amount: ${JSON.stringify(amount)}`)
  }
  const negative = s.startsWith("-")
  const [intPart, fracPart = ""] = s.replace(/^-/, "").split(".")
  const frac = (fracPart + "00").slice(0, 2)
  const minor = Number(intPart) * 100 + Number(frac)
  return negative ? -minor : minor
}

/** Format integer minor units back to a 2dp decimal string, e.g. 3334 -> "33.34". */
export function fromMinor(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`minor units must be an integer, got ${minor}`)
  }
  const negative = minor < 0
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const frac = abs % 100
  return `${negative ? "-" : ""}${major}.${String(frac).padStart(2, "0")}`
}

/**
 * Split a total EQUALLY across participants, in minor units, so the shares
 * sum EXACTLY to the total. The leftover (total mod n) minor units are handed
 * out one-at-a-time to the earliest participants in the given order — pass the
 * payer first if you want them to absorb the rounding.
 */
export function splitEqual(totalMinor: number, participantIds: string[]): Share[] {
  const n = participantIds.length
  if (n === 0) throw new Error("cannot split among zero participants")
  if (totalMinor < 0) throw new Error("total must be non-negative")
  const base = Math.floor(totalMinor / n)
  const remainder = totalMinor - base * n // 0 .. n-1
  return participantIds.map((userId, i) => ({
    userId,
    shareMinor: base + (i < remainder ? 1 : 0),
  }))
}

/**
 * Validate user-supplied EXACT shares: must be non-negative and sum exactly to
 * the total. Throws a descriptive error otherwise. Returns the shares
 * unchanged so it can be used inline.
 */
export function assertExactShares(totalMinor: number, shares: Share[]): Share[] {
  if (shares.length === 0) throw new Error("no shares provided")
  let sum = 0
  for (const s of shares) {
    if (!Number.isInteger(s.shareMinor)) {
      throw new Error(`share for ${s.userId} is not an integer minor amount`)
    }
    if (s.shareMinor < 0) {
      throw new Error(`share for ${s.userId} cannot be negative`)
    }
    sum += s.shareMinor
  }
  if (sum !== totalMinor) {
    throw new Error(
      `shares sum to ${fromMinor(sum)} but the bill total is ${fromMinor(totalMinor)}`
    )
  }
  return shares
}

export type ComputeSplitInput =
  | { type: "equal"; totalMinor: number; participantIds: string[] }
  | { type: "exact"; totalMinor: number; shares: Share[] }

/** Dispatch helper: produce validated shares for either supported split type. */
export function computeSplit(input: ComputeSplitInput): Share[] {
  switch (input.type) {
    case "equal":
      return splitEqual(input.totalMinor, input.participantIds)
    case "exact":
      return assertExactShares(input.totalMinor, input.shares)
    default: {
      const _exhaustive: never = input
      throw new Error(`unsupported split type: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

export interface BalanceInput {
  expenses: Array<{
    paidBy: string
    amountMinor: number
    splits: Share[]
  }>
  settlements: Array<{
    fromUserId: string
    toUserId: string
    amountMinor: number
  }>
}

/**
 * Net balance per user, in minor units.
 *   net = paid - owed + settlementsPaid - settlementsReceived
 * Positive  => the group owes this user (they are a creditor).
 * Negative  => this user owes the group (they are a debtor).
 * Because each bill contributes +amount and -sum(shares) (== -amount), and each
 * settlement contributes +x and -x, the returned values always sum to zero.
 */
export function computeBalances(input: BalanceInput): Map<string, number> {
  const net = new Map<string, number>()
  const add = (userId: string, deltaMinor: number) => {
    net.set(userId, (net.get(userId) ?? 0) + deltaMinor)
  }

  for (const e of input.expenses) {
    add(e.paidBy, e.amountMinor) // fronted the money -> owed to them
    for (const s of e.splits) add(s.userId, -s.shareMinor) // owes their share
  }
  for (const st of input.settlements) {
    add(st.fromUserId, st.amountMinor) // paying reduces what they owe
    add(st.toUserId, -st.amountMinor) // receiving reduces what they're owed
  }

  return net
}

/**
 * Greedy debt simplification ("who pays whom") over net balances. Repeatedly
 * matches the largest debtor with the largest creditor. Produces at most
 * n-1 transfers and fully settles when balances sum to zero (they always do
 * for output of computeBalances). This is the standard heuristic used by
 * Splitwise-style apps — not provably minimal (that problem is NP-hard) but
 * near-optimal and stable.
 *
 * `order` optionally fixes tie-breaking so results are deterministic across
 * runs regardless of Map iteration order — pass a stable userId ordering.
 */
export function simplifyDebts(
  net: Map<string, number>,
  order?: string[]
): Transfer[] {
  const rank = new Map<string, number>()
  const ids = order ?? [...net.keys()]
  ids.forEach((id, i) => rank.set(id, i))
  const tieRank = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER

  const creditors: Array<{ userId: string; amt: number }> = []
  const debtors: Array<{ userId: string; amt: number }> = []
  for (const [userId, amt] of net) {
    if (amt > 0) creditors.push({ userId, amt })
    else if (amt < 0) debtors.push({ userId, amt: -amt })
  }

  const byAmountThenId = (
    a: { userId: string; amt: number },
    b: { userId: string; amt: number }
  ) => b.amt - a.amt || tieRank(a.userId) - tieRank(b.userId)
  creditors.sort(byAmountThenId)
  debtors.sort(byAmountThenId)

  const transfers: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!
    const creditor = creditors[j]!
    const pay = Math.min(debtor.amt, creditor.amt)
    if (pay > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountMinor: pay,
      })
    }
    debtor.amt -= pay
    creditor.amt -= pay
    if (debtor.amt === 0) i++
    if (creditor.amt === 0) j++
  }
  return transfers
}

export interface SerializedBalances {
  /** Net per user. `amount` is the decimal string; `netMinor` the raw integer. */
  balances: Array<{ userId: string; amount: string; netMinor: number }>
  /** Simplified "who pays whom" suggestions with decimal amounts. */
  transfers: Array<{ fromUserId: string; toUserId: string; amount: string }>
}

/**
 * Turn a net-balance map into an API-friendly shape (decimal strings) plus the
 * simplified settlement suggestions. Shared so the app and MCP emit identical
 * output. Pass `order` (e.g. sorted member ids) for deterministic results.
 */
export function serializeBalances(
  net: Map<string, number>,
  order?: string[]
): SerializedBalances {
  const ids = order ?? [...net.keys()]
  const balances = ids
    .filter((id) => net.has(id))
    .map((userId) => {
      const netMinor = net.get(userId) ?? 0
      return { userId, amount: fromMinor(netMinor), netMinor }
    })
  const transfers = simplifyDebts(net, order).map((t) => ({
    fromUserId: t.fromUserId,
    toUserId: t.toUserId,
    amount: fromMinor(t.amountMinor),
  }))
  return { balances, transfers }
}
