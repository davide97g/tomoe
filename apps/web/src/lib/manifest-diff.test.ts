import { parseManifest, type Manifest } from "@tomoe/core"
import { describe, expect, it } from "vitest"

import { diffManifests } from "./manifest-diff.ts"

const field = (name: string, extra: Record<string, unknown> = {}) => ({ name, label: name, type: "string", role: "text", ...extra })
const manifest = (sources: unknown[], actions: unknown[] = []): Manifest => {
  const r = parseManifest({ version: 1, app: { name: "Made-up" }, sources, actions })
  if ("error" in r) throw new Error(r.error)
  return r.manifest
}
const items = (fields: unknown[], path = "/items") => ({ id: "items", label: "Items", key: "id", origin: { kind: "rest", method: "GET", path }, fields: [field("id", { role: "id" }), ...fields] })

describe("diffManifests", () => {
  it("says nothing changed for the same manifest", () => {
    const m = manifest([items([field("name")])])
    expect(diffManifests(m, m).same).toBe(true)
  })

  it("lists added and removed sources, fields, roles, sensitivity and paths", () => {
    const before = manifest([items([field("name"), field("note")]), { ...items([]), id: "old", label: "Old" }])
    const after = manifest([items([field("name", { sensitive: true }), field("total", { type: "number", role: "measure" })], "/v2/items"), { ...items([]), id: "fresh", label: "Fresh" }])
    const d = diffManifests(before, after)
    expect(d.added).toEqual([{ id: "fresh", label: "Fresh" }])
    expect(d.removed).toEqual([{ id: "old", label: "Old" }])
    expect(d.changed).toEqual([{ id: "items", label: "Items", notes: ["read from GET /items → GET /v2/items", "+ total", "− note", "name: now sensitive"] }])
    expect(d.same).toBe(false)
  })

  it("treats everything as added when nothing was accepted yet", () => {
    expect(diffManifests(null, manifest([items([])])).added).toHaveLength(1)
  })
})
