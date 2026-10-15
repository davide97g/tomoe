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

  it("tests each source with a timed sample: counts and errors, never values", async () => {
    const r = await req("/api/apps/example-shop/test", json({}))
    expect(r.status).toBe(200)
    const body = (await r.json()) as { results: { source: string; ok: boolean; rows: number; ms: number; missing: string[]; error: string | null }[] }
    expect(body.results.map((x) => x.source)).toEqual(["orders", "customers"])
    for (const x of body.results) expect(x).toMatchObject({ ok: true, missing: [], error: null })
    expect(body.results[0].rows).toBeGreaterThan(100)
    expect(Object.keys(body.results[0]).sort()).toEqual(["error", "label", "missing", "ms", "ok", "origin", "rows", "source"])
    const detail = (await (await req("/api/apps/example-shop")).json()) as { checks: Record<string, { ok: boolean }>; accepted: string | null }
    expect(detail.checks.orders.ok).toBe(true)
    expect(detail.accepted).toMatch(/^\d{4}-/)
    const unknown = await req("/api/apps/example-shop/test", json({ source: "nope" }))
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { error: string }).error).toContain("orders, customers")
  })

  it("keeps header values write-only and patches only what is sent", async () => {
    const created = await req("/api/apps", json({ name: "Closed", connection: { url: "http://127.0.0.1:59999", headers: { Authorization: "Bearer s3cret" } } }))
    const id = ((await created.json()) as { id: string }).id
    const patch = (body: unknown) => req(`/api/apps/${id}`, { ...json(body), method: "PATCH" })
    const read = async () => (await (await req(`/api/apps/${id}`)).json()) as { app: { connection: Record<string, unknown> } }
    expect(JSON.stringify(await read())).not.toContain("s3cret")
    expect((await patch({ connection: { website: "https://closed.example" } })).status).toBe(200)
    expect(s.store.app(id)?.connection.headers).toEqual({ Authorization: "Bearer s3cret" })
    await patch({ connection: { headers: { Authorization: "" } } })
    expect(s.store.app(id)?.connection.headers).toEqual({ Authorization: "Bearer s3cret" })
    await patch({ connection: { headers: { Authorization: "Bearer n3w" }, website: null } })
    expect(s.store.app(id)?.connection).toMatchObject({ headers: { Authorization: "Bearer n3w" }, url: "http://127.0.0.1:59999" })
    expect(s.store.app(id)?.connection.website).toBeUndefined()
    expect((await patch({ connection: { repo: "/no/such/folder" } })).status).toBe(400)
    // A stored value never follows the API to another origin.
    await patch({ connection: { url: "http://127.0.0.1:59998", headers: { Authorization: "•••" } } })
    expect(s.store.app(id)?.connection.headers).toEqual({})
    await patch({ connection: { url: "http://127.0.0.1:59999", headers: { Authorization: "Bearer n3w" } } })
    await patch({ connection: { url: "http://127.0.0.1:59999/v2" } })
    expect(s.store.app(id)?.connection.headers).toEqual({ Authorization: "Bearer n3w" })
    // A source on a closed port: the check says so in words, and stays a GET on the connected origin.
    const manifest = { version: 1, app: { name: "Closed" }, sources: [{ id: "items", label: "Items", key: "id", origin: { kind: "rest", method: "GET", path: "/items" }, fields: [{ name: "id", label: "Id", type: "string", role: "id" }] }], actions: [] }
    expect((await req(`/api/apps/${id}/manifest`, json({ manifest }))).status).toBe(200)
    const check = (await (await req(`/api/apps/${id}/test`, json({ source: "items" }))).json()) as { results: { ok: boolean; error: string }[] }
    expect(check.results[0].ok).toBe(false)
    expect(check.results[0].error).toContain("http://127.0.0.1:59999 refused the connection")
  })

  it("serves the sandbox page with its own CSP", async () => {
    const r = await req("/sandbox/widget.html")
    expect(r.headers.get("content-security-policy")).toBe(SANDBOX_CSP)
  })
})
