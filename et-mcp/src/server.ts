import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ZodRawShape } from "zod"
import { addCategory } from "./tools/add-category.js"
import { addExpense } from "./tools/add-expense.js"
import { addGroupExpense } from "./tools/add-group-expense.js"
import { createGroup } from "./tools/create-group.js"
import { listGroups } from "./tools/list-groups.js"
import { getGroup } from "./tools/get-group.js"
import { addGroupMember } from "./tools/add-group-member.js"
import { removeGroupMember } from "./tools/remove-group-member.js"
import { listGroupExpenses } from "./tools/list-group-expenses.js"
import { getGroupBalances } from "./tools/get-group-balances.js"
import { recordSettlement } from "./tools/record-settlement.js"
import { bulkAddExpenses } from "./tools/bulk-add-expenses.js"
import { deleteExpense } from "./tools/delete-expense.js"
import { editExpense } from "./tools/edit-expense.js"
import { getExpenseById } from "./tools/get-expense-by-id.js"
import { getExpenses } from "./tools/get-expenses.js"
import { getExpensesByCategory } from "./tools/get-expenses-by-category.js"
import { getSpendingSummary } from "./tools/get-spending-summary.js"
import { listCategories } from "./tools/list-categories.js"
import { toToolResult } from "./lib/errors.js"
import { log, userIdHash } from "./lib/logger.js"
import { getContext } from "./context.js"
import type { ToolDef } from "./tools/types.js"

const TOOLS: ToolDef<ZodRawShape>[] = [
  addExpense,
  getExpenses,
  bulkAddExpenses,
  editExpense,
  deleteExpense,
  getExpenseById,
  listCategories,
  addCategory,
  getSpendingSummary,
  getExpensesByCategory,
  createGroup,
  listGroups,
  getGroup,
  addGroupMember,
  removeGroupMember,
  addGroupExpense,
  listGroupExpenses,
  getGroupBalances,
  recordSettlement,
] as unknown as ToolDef<ZodRawShape>[]

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "et-mcp", version: "0.1.0" },
    {
      instructions:
        "Expense tracker MCP. Personal-expense tools operate on the authenticated user's data only. " +
        "Amounts are decimals in the user's currency (no currency arg). " +
        "Dates are ISO YYYY-MM-DD; when omitted on writes, 'today' means today in the user's timezone. " +
        "delete_expense requires confirm: true. " +
        "Groups: create_group, list_groups, get_group, add_group_member (by email — registered users join now, others get a pending invite), " +
        "remove_group_member, add_group_expense (split a bill 'equal' or 'exact' among selected members), list_group_expenses, " +
        "get_group_balances (net per member + simplified who-pays-whom), and record_settlement (settle up). " +
        "Group tools require you to be an active member; a bill's currency is the group's currency.",
    },
  )

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, unknown>) => {
        const started = Date.now()
        let outcome: "ok" | "error" = "ok"
        let ctxUser: string | undefined
        try {
          ctxUser = getContext().userId
        } catch {
          // no context — auth layer should have rejected before now
        }
        try {
          const result = await tool.handler(args as never)
          return result
        } catch (err) {
          outcome = "error"
          return toToolResult(err)
        } finally {
          log.info({
            tool: tool.name,
            user: userIdHash(ctxUser),
            ms: Date.now() - started,
            outcome,
          })
        }
      },
    )
  }

  return server
}
