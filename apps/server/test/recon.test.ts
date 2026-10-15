// Recon on a URL: a made-up site that publishes llms.txt, an OpenAPI document behind a service-desc
// link, and Tomoe's own /.well-known/tomoe.json with an inline manifest; and a bare site with nothing.
import { readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { recon, reconNote } from "../src/recon.ts"

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../examples/shop/manifest.json"), "utf8"))
manifest.sources[1].origin = { kind: "rest", method: "GET", path: "/api/customers", pagination: "none" }

function site(routes: Record<string, [string, string]>): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const route = routes[new URL(req.url ?? "/", "http://x").pathname]
    if (req.method !== "GET" || !route) {
      res.writeHead(404, { "Content-Type": "text/html" })
      return res.end("<html><title>Not found</title></html>")
    }
    res.writeHead(200, { "Content-Type": route[0] })
    res.end(route[1])
  })
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })))
}

let ready: { server: Server; url: string }
let bare: { server: Server; url: string }

beforeAll(async () => {
  ready = await site({
    "/": ["text/html", `<!doctype html><html><head><title>Example Shop | Orders made simple</title><meta name="description" content="A made-up shop."><link rel="service-desc" href="/docs/api.json"></head><body><div id="__next"></div><script src="/_next/app.js"></script></body></html>`],
    "/llms.txt": ["text/plain", "# Example Shop\n\n> A made-up shop. The API is read with GET /api/orders."],
    "/docs/api.json": ["application/json", JSON.stringify({ openapi: "3.1.0", info: { title: "Example Shop API" }, servers: [{ url: "/api" }], paths: { "/orders": {}, "/customers": {} } })],
    "/.well-known/tomoe.json": ["application/json", JSON.stringify({ tomoe: 1, name: "Example Shop", api: "/", app: "/", manifest })],
  })
  bare = await site({ "/": ["text/html", "<html><head><title>Just a page</title></head></html>"] })
})
afterAll(() => {
  ready.server.close()
  bare.server.close()
})

describe("recon", () => {
  it("finds what a Tomoe-ready app publishes and suggests the connection", async () => {
    const r = await recon(ready.url)
    const found = Object.fromEntries(r.findings.map((f) => [f.kind, f]))
    expect(found.homepage.note).toContain("Example Shop")
    expect(found.homepage.note).toContain("Next.js")
    expect(found.llms.ok).toBe(true)
    expect(found.openapi).toMatchObject({ ok: true, url: `${ready.url}/docs/api.json` })
    expect(found.tomoe.ok).toBe(true)
    expect(r.manifest?.sources.map((s) => s.id)).toEqual(["orders", "customers"])
    expect(r.suggested).toMatchObject({ name: "Example Shop", openapi: `${ready.url}/docs/api.json`, website: `${ready.url}/` })
    expect(reconNote(r)).toContain("A made-up shop. The API is read with GET /api/orders.")
  })

  it("reports a bare site as not ready, without inventing anything", async () => {
    const r = await recon(bare.url)
    expect(r.findings.filter((f) => f.ok).map((f) => f.kind)).toEqual(["homepage"])
    expect(r.manifest).toBeUndefined()
    expect(r.suggested.api).toBeUndefined()
    expect(r.suggested.openapi).toBeUndefined()
  })

  it("takes a host without a scheme", async () => {
    const r = await recon(ready.url.replace("http://", ""))
    expect(r.origin).toBe(ready.url)
    expect(r.manifest).toBeDefined()
  })

  it("refuses what is not an http URL", async () => {
    await expect(recon("ftp://example.test")).rejects.toThrow()
  })
})
