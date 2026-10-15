import { parseManifest } from "@tomoe/core"
import { describe, expect, it } from "vitest"

import { coerce, rowsOf } from "../src/adapter.ts"
import { inferSource, parseCsv } from "../src/infer.ts"

const CSV = `Date;Category;Amount;Customer name;Note
2026-01-03;food;12,50;Ada Example;"said ""hi"""
2026-01-04;rent;800;Bruno Sample;
2026-02-01;food;9;Ada Example;
2026-02-03;food;4;Clara Demo;
2026-02-09;rent;800;Bruno Sample;
`

describe("data files", () => {
  it("parses CSV with quotes and semicolons", () => {
    const rows = parseCsv(CSV)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ Date: "2026-01-03", Note: 'said "hi"' })
  })

  it("guesses types, roles and sensitivity, and makes a valid source", () => {
    const r = inferSource("spending.csv", CSV, [])
    if ("error" in r) throw new Error(r.error)
    const f = Object.fromEntries(r.source.fields.map((x) => [x.name, x]))
    expect(r.source).toMatchObject({ id: "spending", key: "_row", time: "date", origin: { kind: "memory" } })
    expect(f.date).toMatchObject({ type: "date", role: "time" })
    expect(f.category).toMatchObject({ type: "enum", role: "dimension", values: ["food", "rent"] })
    expect(f.customer_name.sensitive).toBe(true)
    expect(f.note.sensitive).toBe(true)
    const m = parseManifest({ version: 1, app: { name: "Files" }, sources: [r.source] })
    expect(m).toHaveProperty("manifest")
  })

  it("refuses a file without a table", () => {
    expect(inferSource("x.json", '{"a": 1}', [])).toHaveProperty("error")
  })
})

describe("adapter", () => {
  it("finds the rows inside common response shapes", () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }])
    expect(rowsOf({ data: { items: [{ a: 1 }] } })).toEqual([{ a: 1 }])
    expect(rowsOf({ total: 2, whatever: [{ a: 1 }] })).toEqual([{ a: 1 }])
    expect(rowsOf({ a: 1 })).toBeNull()
  })

  it("coerces values to the manifest's types", () => {
    const f = (type: string) => ({ name: "x", label: "x", type, role: "dimension", sensitive: false }) as never
    expect(coerce(f("number"), "1,234.5")).toBe(1234.5)
    expect(coerce(f("date"), "2026-03-04T10:00:00Z")).toBe("2026-03-04")
    expect(coerce(f("date"), 1_772_582_400)).toBe("2026-03-04")
    expect(coerce(f("boolean"), "true")).toBe(true)
    expect(coerce(f("string"), "")).toBeNull()
  })
})
