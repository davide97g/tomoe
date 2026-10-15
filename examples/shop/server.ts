// A made-up shop to connect Tomoe to: `pnpm example:server`, then Connect → http://127.0.0.1:8792.
// Read-only JSON API with an OpenAPI document, and Tomoe-ready (skills/tomoe-ready): a homepage with a
// service-desc link, /llms.txt and /.well-known/tomoe.json with the manifest, so Connect needs no agent.
// EXAMPLE_PLAIN=1 serves the API alone, to watch the discovery agent work it out. Made-up data only.
import { readFileSync } from "node:fs"
import { createServer } from "node:http"

import { shopRows } from "./data.ts"

const PORT = Number(process.env.PORT ?? 8792)
const PLAIN = process.env.EXAMPLE_PLAIN === "1"
const rows = shopRows()

// The example manifest, with both sources read from this API.
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"))
manifest.sources[0].origin = { kind: "rest", method: "GET", path: "/api/orders", pagination: "offset" }
manifest.sources[1].origin = { kind: "rest", method: "GET", path: "/api/customers", pagination: "offset" }

const ready: Record<string, [string, string]> = {
  "/": [
    "text/html; charset=utf-8",
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example Shop</title><meta name="description" content="A made-up online shop: orders, customers, products."><link rel="service-desc" type="application/json" href="/openapi.json"></head><body><h1>Example Shop</h1><p>A made-up shop for trying Tomoe.</p></body></html>`,
  ],
  "/llms.txt": [
    "text/plain; charset=utf-8",
    "# Example Shop\n\n> A made-up online shop: orders and customers. Read-only JSON API on this origin, paginated with limit and offset.\n\n## API\n- [OpenAPI](/openapi.json): the read endpoints\n- [Tomoe discovery](/.well-known/tomoe.json): sources and deep links for dashboards\n",
  ],
  "/.well-known/tomoe.json": [
    "application/json",
    JSON.stringify({ tomoe: 1, name: "Example Shop", description: "A made-up online shop.", api: "/", openapi: "/openapi.json", manifest: "/tomoe.manifest.json", app: "/", llms: "/llms.txt" }),
  ],
  "/tomoe.manifest.json": ["application/json", JSON.stringify(manifest)],
}

const field = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra })
const openapi = {
  openapi: "3.1.0",
  info: { title: "Example Shop API", version: "1.0.0", description: "A made-up online shop." },
  paths: {
    "/api/orders": {
      get: {
        summary: "List orders, newest first",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "A page of orders", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Order" } }, total: { type: "integer" } } } } } } },
      },
    },
    "/api/customers": {
      get: {
        summary: "List customers",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "A page of customers", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Customer" } }, total: { type: "integer" } } } } } } },
      },
    },
    "/api/orders/{id}/refund": { post: { summary: "Refund an order", responses: { "204": { description: "Refunded" } } } },
  },
  components: {
    schemas: {
      Order: {
        type: "object",
        properties: {
          id: field("string"),
          created_at: field("string", { format: "date" }),
          status: field("string", { enum: ["open", "paid", "shipped", "refunded"] }),
          channel: field("string", { enum: ["web", "app", "store"] }),
          total: field("number", { description: "Order total in EUR" }),
          customer_id: field("string"),
          note: field("string", { nullable: true, description: "Delivery note written by the customer" }),
        },
      },
      Customer: {
        type: "object",
        properties: { id: field("string"), name: field("string"), country: field("string", { enum: ["IT", "FR", "DE", "ES"] }), signed_up: field("string", { format: "date" }) },
      },
    },
  },
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }
  if (req.method !== "GET") return send(405, { error: "read-only example" })
  if (url.pathname === "/openapi.json") return send(200, openapi)
  const page = PLAIN ? undefined : ready[url.pathname]
  if (page) {
    res.writeHead(200, { "Content-Type": page[0] })
    return res.end(page[1])
  }
  const list = url.pathname === "/api/orders" ? rows.orders : url.pathname === "/api/customers" ? rows.customers : null
  if (!list) return send(404, { error: "not found" })
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100) || 100)
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0)
  send(200, { data: list.slice(offset, offset + limit), total: list.length })
}).listen(PORT, "127.0.0.1", () => console.log(`example shop on http://127.0.0.1:${PORT} (${PLAIN ? "API only" : "Tomoe-ready"}; OpenAPI: /openapi.json)`))
