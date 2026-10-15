// The agents' tool profiles are the security boundary (not the prompt): read-only, no shell, web only
// on the domains the user typed, never the app's own files.
import { describe, expect, it } from "vitest"

import { tools } from "../src/claude.ts"

describe("tool profile", () => {
  it("keeps the chat agent read-only, without shell, and the web pinned to the user's links", () => {
    const t = tools({ app: "/data/apps/shop", webDomains: ["example.com"] })
    expect(t.available).toEqual(["Read", "Glob", "Grep", "WebFetch"])
    expect(t.allowed).toEqual(["Read", "Glob", "Grep", "mcp__tomoe", "WebFetch(domain:example.com)"])
    for (const tool of ["Bash", "Edit", "Write", "WebSearch", "Task"]) expect(t.denied).toContain(tool)
    expect(t.denied).toContain("Read(//data/apps/shop/*.json)")
    expect(t.denied).toContain("Read(**/.env)")
  })

  it("gives no web at all without domains, and never web search", () => {
    expect(tools({ app: "/a" }).available).not.toContain("WebFetch")
    const d = tools({ app: "/a", webDomains: ["app.example.com"] })
    expect(d.allowed.filter((x) => x.startsWith("WebFetch"))).toEqual(["WebFetch(domain:app.example.com)"])
    expect(d.denied).toContain("WebSearch")
  })
})
