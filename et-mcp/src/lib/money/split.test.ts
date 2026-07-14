import { test } from "node:test"
import assert from "node:assert/strict"
import {
  toMinor,
  fromMinor,
  splitEqual,
  assertExactShares,
  computeSplit,
  computeBalances,
  simplifyDebts,
  type Share,
} from "./split.js"

const sum = (shares: Share[]) => shares.reduce((a, s) => a + s.shareMinor, 0)
const netTotal = (m: Map<string, number>) =>
  [...m.values()].reduce((a, b) => a + b, 0)

// --------------------------------------------------------------------------
// toMinor / fromMinor
// --------------------------------------------------------------------------
test("toMinor parses strings and numbers", () => {
  assert.equal(toMinor("100"), 10000)
  assert.equal(toMinor("100.5"), 10050)
  assert.equal(toMinor("100.55"), 10055)
  assert.equal(toMinor("0.01"), 1)
  assert.equal(toMinor(1200), 120000)
  assert.equal(toMinor("-5.25"), -525)
})

test("toMinor rejects >2 fractional digits and junk", () => {
  assert.throws(() => toMinor("1.234"))
  assert.throws(() => toMinor("abc"))
  assert.throws(() => toMinor("1,000"))
})

test("fromMinor round-trips and pads", () => {
  assert.equal(fromMinor(10000), "100.00")
  assert.equal(fromMinor(3334), "33.34")
  assert.equal(fromMinor(5), "0.05")
  assert.equal(fromMinor(-525), "-5.25")
  for (const v of ["0.00", "0.01", "99.99", "1200.00", "33.33"]) {
    assert.equal(fromMinor(toMinor(v)), v)
  }
})

// --------------------------------------------------------------------------
// splitEqual — the rounding invariant is the whole point
// --------------------------------------------------------------------------
test("splitEqual divides evenly when it can", () => {
  const shares = splitEqual(120000, ["a", "b", "c"])
  assert.deepEqual(
    shares.map((s) => s.shareMinor),
    [40000, 40000, 40000]
  )
})

test("splitEqual distributes the remainder and still sums to total", () => {
  // 100.00 / 3 = 33.34, 33.33, 33.33
  const shares = splitEqual(10000, ["a", "b", "c"])
  assert.deepEqual(
    shares.map((s) => s.shareMinor),
    [3334, 3333, 3333]
  )
  assert.equal(sum(shares), 10000)
})

test("splitEqual remainder goes to earliest participants (pass payer first)", () => {
  // 0.10 / 4 = 3,3,2,2 paise
  const shares = splitEqual(10, ["payer", "b", "c", "d"])
  assert.deepEqual(
    shares.map((s) => s.shareMinor),
    [3, 3, 2, 2]
  )
  assert.equal(sum(shares), 10)
})

test("splitEqual sums to total for many awkward amounts", () => {
  for (let total = 1; total <= 2000; total++) {
    for (let n = 1; n <= 7; n++) {
      const ids = Array.from({ length: n }, (_, i) => `u${i}`)
      assert.equal(sum(splitEqual(total, ids)), total)
    }
  }
})

test("splitEqual rejects empty and negative", () => {
  assert.throws(() => splitEqual(100, []))
  assert.throws(() => splitEqual(-100, ["a"]))
})

// --------------------------------------------------------------------------
// assertExactShares
// --------------------------------------------------------------------------
test("assertExactShares accepts shares that sum to total", () => {
  const shares: Share[] = [
    { userId: "a", shareMinor: 4000 },
    { userId: "b", shareMinor: 5000 },
    { userId: "c", shareMinor: 3000 },
  ]
  assert.equal(sum(assertExactShares(12000, shares)), 12000)
})

test("assertExactShares rejects mismatched sum and negatives", () => {
  assert.throws(
    () =>
      assertExactShares(12000, [
        { userId: "a", shareMinor: 4000 },
        { userId: "b", shareMinor: 4000 },
      ]),
    /sum to 80\.00 but the bill total is 120\.00/
  )
  assert.throws(() =>
    assertExactShares(1000, [{ userId: "a", shareMinor: -1000 }])
  )
})

// --------------------------------------------------------------------------
// computeSplit dispatch
// --------------------------------------------------------------------------
test("computeSplit routes equal and exact", () => {
  const eq = computeSplit({
    type: "equal",
    totalMinor: 9000,
    participantIds: ["a", "b", "c"],
  })
  assert.equal(sum(eq), 9000)

  const ex = computeSplit({
    type: "exact",
    totalMinor: 9000,
    shares: [
      { userId: "a", shareMinor: 5000 },
      { userId: "b", shareMinor: 4000 },
    ],
  })
  assert.equal(sum(ex), 9000)
})

// --------------------------------------------------------------------------
// computeBalances
// --------------------------------------------------------------------------
test("computeBalances: payer is owed, others owe, nets to zero", () => {
  // a paid 120.00, split equally 3 ways (40 each)
  const net = computeBalances({
    expenses: [
      {
        paidBy: "a",
        amountMinor: 12000,
        splits: splitEqual(12000, ["a", "b", "c"]),
      },
    ],
    settlements: [],
  })
  assert.equal(net.get("a"), 8000) // paid 120, owed 40 -> +80
  assert.equal(net.get("b"), -4000)
  assert.equal(net.get("c"), -4000)
  assert.equal(netTotal(net), 0)
})

test("computeBalances: a settlement squares a debtor and creditor", () => {
  const net = computeBalances({
    expenses: [
      {
        paidBy: "a",
        amountMinor: 12000,
        splits: splitEqual(12000, ["a", "b", "c"]),
      },
    ],
    // b pays a back 40.00
    settlements: [{ fromUserId: "b", toUserId: "a", amountMinor: 4000 }],
  })
  assert.equal(net.get("b"), 0) // debt cleared
  assert.equal(net.get("a"), 4000) // still owed by c
  assert.equal(net.get("c"), -4000)
  assert.equal(netTotal(net), 0)
})

// --------------------------------------------------------------------------
// simplifyDebts
// --------------------------------------------------------------------------
test("simplifyDebts fully settles and conserves money", () => {
  const net = new Map([
    ["a", 8000],
    ["b", -4000],
    ["c", -4000],
  ])
  const order = ["a", "b", "c"]
  const transfers = simplifyDebts(net, order)
  // Every transfer positive; applying them zeroes every balance.
  const after = new Map(net)
  for (const t of transfers) {
    assert.ok(t.amountMinor > 0)
    after.set(t.fromUserId, (after.get(t.fromUserId) ?? 0) + t.amountMinor)
    after.set(t.toUserId, (after.get(t.toUserId) ?? 0) - t.amountMinor)
  }
  for (const v of after.values()) assert.equal(v, 0)
})

test("simplifyDebts produces at most n-1 transfers and is deterministic", () => {
  const net = new Map([
    ["a", 5000],
    ["b", 3000],
    ["c", -6000],
    ["d", -2000],
  ])
  const order = ["a", "b", "c", "d"]
  const t1 = simplifyDebts(net, order)
  const t2 = simplifyDebts(new Map(net), order)
  assert.ok(t1.length <= 3)
  assert.deepEqual(t1, t2) // stable given a fixed order
})
