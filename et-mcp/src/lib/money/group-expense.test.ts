import { test } from "node:test"
import assert from "node:assert/strict"
import { buildGroupExpense, GroupExpenseError } from "./group-expense.js"

const base = {
  expenseId: "exp-1",
  groupId: "grp-1",
  currency: "INR",
  category: "Food",
  date: "2026-07-14",
  createdBy: "u-a",
  activeMemberIds: new Set(["u-a", "u-b", "u-c"]),
}

const sumShares = (splits: { shareAmount: string }[]) =>
  splits.reduce((acc, s) => acc + Math.round(Number(s.shareAmount) * 100), 0)

test("equal split: shares sum to total, payer absorbs the remainder", () => {
  const built = buildGroupExpense({
    ...base,
    paidBy: "u-a",
    amount: "100",
    splitType: "equal",
    participants: [{ userId: "u-a" }, { userId: "u-b" }, { userId: "u-c" }],
  })
  assert.equal(built.expense.amount, "100.00")
  assert.equal(sumShares(built.splits), 10000)
  // payer u-a listed first -> gets the extra paise
  const byUser = new Map(built.splits.map((s) => [s.userId, s.shareAmount]))
  assert.equal(byUser.get("u-a"), "33.34")
  assert.equal(byUser.get("u-b"), "33.33")
  assert.equal(byUser.get("u-c"), "33.33")
})

test("equal split works when payer is not a participant", () => {
  const built = buildGroupExpense({
    ...base,
    paidBy: "u-a", // paid but not consuming
    amount: "100",
    splitType: "equal",
    participants: [{ userId: "u-b" }, { userId: "u-c" }],
  })
  assert.equal(sumShares(built.splits), 10000)
  assert.equal(built.splits.length, 2)
})

test("exact split: validated and stored verbatim", () => {
  const built = buildGroupExpense({
    ...base,
    paidBy: "u-a",
    amount: "120",
    splitType: "exact",
    participants: [
      { userId: "u-a", shareAmount: "40" },
      { userId: "u-b", shareAmount: "50" },
      { userId: "u-c", shareAmount: "30" },
    ],
  })
  assert.equal(sumShares(built.splits), 12000)
})

test("reflectToPersonal honored only for the creator's own share", () => {
  const built = buildGroupExpense({
    ...base,
    createdBy: "u-a",
    paidBy: "u-a",
    amount: "90",
    splitType: "equal",
    participants: [
      { userId: "u-a", reflectToPersonal: true },
      { userId: "u-b", reflectToPersonal: true }, // must be ignored
      { userId: "u-c" },
    ],
  })
  const byUser = new Map(built.splits.map((s) => [s.userId, s.reflectToPersonal]))
  assert.equal(byUser.get("u-a"), true)
  assert.equal(byUser.get("u-b"), false) // can't opt someone else in
  assert.equal(byUser.get("u-c"), false)
})

test("activity row records the addition", () => {
  const built = buildGroupExpense({
    ...base,
    paidBy: "u-a",
    amount: "60",
    splitType: "equal",
    participants: [{ userId: "u-a" }, { userId: "u-b" }],
  })
  assert.equal(built.activity.type, "expense_added")
  assert.equal(built.activity.actorId, "u-a")
  assert.equal(built.activity.payload.participantCount, 2)
  assert.equal(built.activity.payload.amount, "60.00")
})

test("rejects zero/negative amount", () => {
  assert.throws(
    () =>
      buildGroupExpense({
        ...base,
        paidBy: "u-a",
        amount: "0",
        splitType: "equal",
        participants: [{ userId: "u-a" }],
      }),
    GroupExpenseError
  )
})

test("rejects a payer who isn't an active member", () => {
  assert.throws(
    () =>
      buildGroupExpense({
        ...base,
        paidBy: "stranger",
        amount: "10",
        splitType: "equal",
        participants: [{ userId: "u-a" }],
      }),
    /payer is not an active member/
  )
})

test("rejects a participant who isn't an active member", () => {
  assert.throws(
    () =>
      buildGroupExpense({
        ...base,
        paidBy: "u-a",
        amount: "10",
        splitType: "equal",
        participants: [{ userId: "u-a" }, { userId: "stranger" }],
      }),
    /not an active member/
  )
})

test("rejects duplicate participants", () => {
  assert.throws(
    () =>
      buildGroupExpense({
        ...base,
        paidBy: "u-a",
        amount: "10",
        splitType: "equal",
        participants: [{ userId: "u-a" }, { userId: "u-a" }],
      }),
    /more than once/
  )
})

test("exact split rejects a missing shareAmount", () => {
  assert.throws(
    () =>
      buildGroupExpense({
        ...base,
        paidBy: "u-a",
        amount: "100",
        splitType: "exact",
        participants: [{ userId: "u-a", shareAmount: "100" }, { userId: "u-b" }],
      }),
    /requires a shareAmount/
  )
})

test("exact split rejects shares that don't sum to total", () => {
  assert.throws(
    () =>
      buildGroupExpense({
        ...base,
        paidBy: "u-a",
        amount: "100",
        splitType: "exact",
        participants: [
          { userId: "u-a", shareAmount: "40" },
          { userId: "u-b", shareAmount: "40" },
        ],
      }),
    /sum to 80\.00 but the bill total is 100\.00/
  )
})
