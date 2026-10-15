import { describe, expect, it } from "vitest"

import { actionPath, createTomoe, parseManifest } from "../src/index.ts"
import { manifestJson, tomoe } from "./fixtures.ts"

const broken = (edit: (m: any) => void) => {
  const m = manifestJson()
  edit(m)
  return parseManifest(m)
}

describe("manifest", () => {
  it("reads the example", () => {
    expect(tomoe.manifest.sources.map((s) => s.id)).toEqual(["orders", "customers"])
    expect(tomoe.manifest.sources[0].maxRows).toBe(5000)
  })

  it("names what is wrong", () => {
    expect(broken((m) => (m.sources[0].key = "nope"))).toEqual({ error: 'sources.0.key: orders: key "nope" is not a field' })
    expect(broken((m) => (m.sources[0].relations[0].to = "ghosts"))).toMatchObject({ error: expect.stringContaining('unknown source "ghosts"') })
    expect(broken((m) => (m.actions[0].target = "/orders/{id}/{line}"))).toMatchObject({ error: expect.stringContaining("placeholder {line} has no param") })
    expect(broken((m) => (m.sources[0].fields[4].type = "string"))).toMatchObject({ error: expect.stringContaining("a measure must be a number") })
    expect(broken((m) => delete m.sources[0].fields[2].values)).toMatchObject({ error: expect.stringContaining("an enum needs its values") })
  })

  it("is read-only and stays on the host", () => {
    expect(broken((m) => (m.sources[0].origin.method = "POST"))).toHaveProperty("error")
    expect(broken((m) => (m.actions[1].target = "//evil.example/x"))).toHaveProperty("error")
    expect(broken((m) => (m.actions[1].target = "https://evil.example/x"))).toHaveProperty("error")
  })

  it("builds action paths from params, encoded", () => {
    expect(actionPath(tomoe.manifest, "open-order", { id: "o/1?x" })).toBe("/orders/o%2F1%3Fx")
    expect(actionPath(tomoe.manifest, "open-order", {})).toBeNull()
    expect(actionPath(tomoe.manifest, "nope", {})).toBeNull()
  })

  it("accepts an app with nothing connected: static and custom widgets only, queries refused", () => {
    const empty = createTomoe({ version: 1, app: { name: "Playground" }, sources: [] })
    const text = { root: "t", elements: { t: { type: "Text", props: { text: "Hello" } } } }
    expect(empty.parseWidget({ id: "hello", title: "Hello", spec: text })).toHaveProperty("widget")
    expect(empty.parseWidget({ id: "art", title: "Art", kind: "custom", code: "ac.render('<b>hi</b>')" })).toHaveProperty("widget")
    const metric = { root: "m", elements: { m: { type: "Metric", props: { label: "N", value: { from: "orders", measure: { op: "count" } } } } } }
    expect(empty.parseWidget({ id: "n", title: "N", spec: metric })).toMatchObject({ error: expect.stringContaining("no data source is connected") })
    expect(empty.instructions()).toContain("none connected yet")
  })
})
