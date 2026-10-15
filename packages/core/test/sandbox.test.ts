// The sandbox page's CSP runs only its own script, by hash: the hash must follow every edit of that
// script, and the copies of the CSP must agree.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { SANDBOX_CSP, SANDBOX_HEADERS, SANDBOX_IFRAME } from "../src/index.ts"
import { tomoe } from "./fixtures.ts"

const page = readFileSync(resolve(import.meta.dirname, "../sandbox/widget.html"), "utf8")

describe("sandbox page", () => {
  it("allows exactly its own script", () => {
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(1)
    const hash = createHash("sha256").update(scripts[0][1]).digest("base64")
    expect(SANDBOX_CSP).toContain(`script-src 'sha256-${hash}';`)
    expect(SANDBOX_CSP).not.toMatch(/script-src[^;]*(?:'unsafe|'self'|https?:)/)
  })

  it("repeats the same CSP in its meta and its headers", () => {
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(page)![1]
    expect(`${meta}; frame-ancestors 'self'`).toBe(SANDBOX_CSP)
    expect(SANDBOX_HEADERS["Content-Security-Policy"]).toBe(SANDBOX_CSP)
  })

  it("blocks every connection and load", () => {
    for (const d of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'", "worker-src blob:", "img-src data:"]) expect(SANDBOX_CSP).toContain(d)
    expect(SANDBOX_IFRAME.sandbox).toBe("allow-scripts")
  })

  it("accepts only the frame's known messages", () => {
    const ok = (v: unknown) => tomoe.SandboxMessage.safeParse(v).success
    expect(ok({ type: "resize", height: 200 })).toBe(true)
    expect(ok({ type: "open", target: { action: "open-order", params: { id: "o-1" } } })).toBe(true)
    expect(ok({ type: "open", target: { action: "open-order" } })).toBe(false)
    expect(ok({ type: "open", target: { action: "delete-everything" } })).toBe(false)
    expect(ok({ type: "navigate", url: "https://evil.example" })).toBe(false)
  })
})
