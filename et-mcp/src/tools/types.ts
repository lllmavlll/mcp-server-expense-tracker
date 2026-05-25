import type { ZodRawShape } from "zod"

export interface ToolDef<Shape extends ZodRawShape> {
  name: string
  title: string
  description: string
  inputSchema: Shape
  handler: (args: { [K in keyof Shape]: import("zod").infer<Shape[K]> }) => Promise<{
    content: { type: "text"; text: string }[]
    isError?: boolean
  }>
}
