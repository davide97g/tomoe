/**
 * Tomoe's MCP server (stdio), started by `claude -p` for each run: the agent's only way to the data.
 * Every tool is read-only and answered by the Tomoe server (`/api/agent/...`, with a per-process token),
 * which validates the input with the same schemas as the widgets and caps the output. No dependencies:
 * newline-delimited JSON-RPC, as MCP's stdio transport specifies.
 */
import { createInterface } from "node:readline"

const URL_BASE = process.env.TOMOE_URL ?? ""
const TOKEN = process.env.TOMOE_TOKEN ?? ""
const APP = process.env.TOMOE_APP ?? ""
const PROFILE = process.env.TOMOE_PROFILE === "discover" ? "discover" : "chat"

type Tool = { name: string; description: string; inputSchema: Record<string, unknown> }

const QUERY = { type: "object", description: "A query as in the widget instructions: {from, where?, window?, select?, sort?, limit?}, plus optional measure (one number) or by (+ measure) (points)." }

const CHAT_TOOLS: Tool[] = [
  { name: "describe_sources", description: "The connected app's Source Manifest: sources, fields (type, role, enum values, sensitivity) and actions.", inputSchema: { type: "object", properties: {} } },
  {
    name: "run_query",
    description: "Run a query on the real data to check a widget will show something sensible before proposing it. Returns at most 20 rows (sensitive values masked), a number when the query has a measure, or points when it has a by.",
    inputSchema: { type: "object", properties: { query: QUERY }, required: ["query"] },
  },
  {
    name: "distinct",
    description: "The most common values of a dimension field, with counts: use real values in filters.",
    inputSchema: { type: "object", properties: { source: { type: "string" }, field: { type: "string" } }, required: ["source", "field"] },
  },
  { name: "read_board", description: "The widgets on the user's Board, as stored (ids, titles, specs or code).", inputSchema: { type: "object", properties: {} } },
]

const DISCOVER_TOOLS: Tool[] = [
  {
    name: "http_get",
    description: "GET a path on the app's API, or a full URL on the app's own origins (website, API, OpenAPI document); read-only. Returns the status, content type and at most 20 KB of the body. Use it for API descriptions, docs pages and probes with small limits (e.g. /api/orders?limit=5).",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "A path on the API, like /api/orders?limit=5" }, url: { type: "string", description: "Or a full URL on one of the app's origins" } } },
  },
  {
    name: "check_manifest",
    description: "Validate a Source Manifest draft and probe its REST sources on the backend. Returns the first schema problem, or the probe report per source (fields missing in the real rows, rows found).",
    inputSchema: { type: "object", properties: { manifest: { type: "object" } }, required: ["manifest"] },
  },
]

const TOOLS = PROFILE === "discover" ? DISCOVER_TOOLS : CHAT_TOOLS

async function call(name: string, args: unknown): Promise<string> {
  if (!TOOLS.some((t) => t.name === name)) throw new Error(`unknown tool ${name}`)
  const r = await fetch(`${URL_BASE}/api/agent/${encodeURIComponent(APP)}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args ?? {}),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(text.slice(0, 2000) || `HTTP ${r.status}`)
  return text
}

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n")

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg: { id?: number | string; method?: string; params?: Record<string, any> }
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  if (id === undefined) return // notifications
  const reply = (result: unknown) => send({ jsonrpc: "2.0", id, result })
  switch (method) {
    case "initialize":
      return reply({ protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "tomoe", version: "0.1.0" } })
    case "ping":
      return reply({})
    case "tools/list":
      return reply({ tools: TOOLS })
    case "tools/call":
      try {
        return reply({ content: [{ type: "text", text: await call(String(params?.name), params?.arguments) }] })
      } catch (e) {
        return reply({ content: [{ type: "text", text: (e as Error).message }], isError: true })
      }
    default:
      return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } })
  }
})
