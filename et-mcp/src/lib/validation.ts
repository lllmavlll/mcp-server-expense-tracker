import { z } from "zod"

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const amount = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toString() : v))
  .refine((s) => /^-?\d+(\.\d{1,2})?$/.test(s), {
    message: "amount must be a decimal with up to 2 fractional digits",
  })

export const uuid = z.string().uuid()

export const categoryName = z.string().trim().min(1).max(100)

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be #RRGGBB")
