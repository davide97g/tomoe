// The API end to end, without Claude: local-only guards, the example app, the board's revisions,
// the agent's tools behind their token, attachments confined to their folder, the sandbox's headers.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SANDBOX_CSP } from "@tomoe/core"
import { beforeAll, describe, expect, it } from "vitest"

import { createApp, services, type Services } from "../src/app.ts"
import { loadConfig } from "../src/config.ts"

let s: Services
let app: ReturnType<typeof createApp>
const req = (path: string, init: RequestInit = {}) => app.request(`http://127.0.0.1:8791${path}`, { ...init, headers: { host: "127.0.0.1:8791", ...init.headers } })
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

const widget = {
  id: "open-orders",
  title: "Open orders",
  size: "small",
  spec: { root: "m", elements: { m: { type: "Metric", props: { label: "Open", value: { from: "orders", where: [{ field: "status", op: "eq", value: "open" }], measure: { op: "count" } } } } } },
}

beforeAll(async () => {
  const config = { ...loadConfig({ TOMOE_DATA: mkdtempSync(join(tmpdir(), "tomoe-")) }), claude: null }
  s = services(config)
  app = createApp(s)
  expect((await req("/api/apps/example", { method: "POST" })).status).toBe(200)
})

describe("api", () => {
  it("answers only on localhost and refuses writes from other origins", async () => {
    expect((await app.request("http://evil.test/api/apps", { headers: { host: "evil.test" } })).status).toBe(403)
    expect((await req("/api/apps/example-shop/board/undo", { method: "POST", headers: { origin: "https://evil.test" } })).status).toBe(403)
  })

  it("lists the playground and the example, and serves rows", async () => {
    const apps = (await (await req("/api/apps")).json()) as { id: string }[]
    expect(apps.map((a) => a.id)).toEqual(["playground", "example-shop"])
    const rows = (await (await req("/api/apps/example-shop/rows?source=orders")).json()) as { rows: unknown[] }
    expect(rows.rows.length).toBeGreaterThan(100)
  })

  it("validates saves again, and undoes each change", async () => {
    const bad = await req("/api/apps/example-shop/board/widgets/open-orders", { ...json({ ...widget, spec: { ...widget.spec, root: "nope" } }), method: "PUT" })
    expect(bad.status).toBe(400)
    const ok = await req("/api/apps/example-shop/board/widgets/open-orders", { ...json(widget), method: "PUT" })
    expect(((await ok.json()) as { added: boolean }).added).toBe(true)
    const undo = (await (await req("/api/apps/example-shop/board/undo", { method: "POST" })).json()) as { board: { widgets: unknown[] }; undone: string }
    expect(undo).toMatchObject({ undone: "Add Open orders", board: { widgets: [] } })
  })

  it("answers the agent's tools only with the token, sensitive values masked", async () => {
    const call = (token: string) => req("/api/agent/example-shop/run_query", { ...json({ query: { from: "orders", limit: 2 } }), headers: { "content-type": "application/json", authorization: `Bearer ${token}` } })
    expect((await call("wrong")).status).toBe(401)
    const r = (await (await call(s.token)).json()) as { rows: Record<string, unknown>[] }
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].total).toBe("•••")
    const refused = await req("/api/agent/example-shop/run_query", { ...json({ query: { from: "orders", where: [{ field: "nope", op: "eq", value: 1 }] } }), headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` } })
    expect(refused.status).toBe(400)
  })

  it("serves attachments only from their folder", async () => {
    for (const path of ["../app.json", "files/../../app.json", "files/2026-01-01-abcdef12/../../app.json"]) {
      expect((await req(`/api/apps/example-shop/files?path=${encodeURIComponent(path)}`)).status).toBe(404)
    }
  })

  it("serves the sandbox page with its own CSP", async () => {
    const r = await req("/sandbox/widget.html")
    expect(r.headers.get("content-security-policy")).toBe(SANDBOX_CSP)
  })
})
