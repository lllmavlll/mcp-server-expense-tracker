export type ErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "CONFIRMATION_REQUIRED"
  | "DB_ERROR"

export class ToolError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function toToolResult(err: unknown): {
  content: { type: "text"; text: string }[]
  isError: true
} {
  if (err instanceof ToolError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ code: err.code, message: err.message }) }],
      isError: true,
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return {
    content: [{ type: "text", text: JSON.stringify({ code: "DB_ERROR", message }) }],
    isError: true,
  }
}
