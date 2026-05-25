import { createHash } from "node:crypto"

const PALETTE = [
  "#f59e0b",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#22c55e",
  "#eab308",
  "#06b6d4",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#6b7280",
] as const

export function colorForCategory(name: string): string {
  const hash = createHash("sha256").update(name.toLowerCase().trim()).digest()
  const idx = hash.readUInt32BE(0) % PALETTE.length
  return PALETTE[idx]!
}
