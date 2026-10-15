import { describe, expect, it } from "vitest"

import { tomoe } from "./fixtures.ts"

const first = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, v: unknown) => {
  const r = schema.safeParse(v)
  return r.success ? null : r.error!.issues[0].message
}

describe("queries generated from the manifest", () => {
  it("accepts a well-formed query", () => {
    expect(first(tomoe.Query, { from: "orders", where: [{ field: "status", op: "in", value: ["open", "paid"] }], window: { last: { months: 3 } }, limit: 10 })).toBeNull()
  })

  it("refuses unknown sources and fields", () => {
    expect(first(tomoe.Query, { from: "invoices" })).not.toBeNull()
    expect(first(tomoe.Query, { from: "orders", where: [{ field: "price", op: "eq", value: 1 }] })).not.toBeNull()
  })

  it("checks operators and values against the field", () => {
    expect(first(tomoe.Query, { from: "orders", where: [{ field: "status", op: "gt", value: "open" }] })).toBe("orders.status (enum) takes eq|ne|in|empty|present")
    expect(first(tomoe.Query, { from: "orders", where: [{ field: "status", op: "eq", value: "lost" }] })).toBe("orders.status: value must be one of open|paid|shipped|refunded")
    expect(first(tomoe.Query, { from: "orders", where: [{ field: "created_at", op: "gte", value: "yesterday" }] })).toBe("orders.created_at: value must be a date YYYY-MM-DD")
    expect(first(tomoe.Query, { from: "orders", where: [{ field: "note", op: "empty", value: "x" }] })).toBe('"empty" takes no value')
  })

  it("checks measures and groupings against roles", () => {
    expect(first(tomoe.Aggregate, { from: "orders", measure: { op: "sum", field: "status" } })).toContain("orders.status is not a measure (total)")
    expect(first(tomoe.Series, { from: "orders", by: { field: "note" } })).toContain("orders.note cannot group")
    expect(first(tomoe.Series, { from: "orders", by: { field: "channel", bucket: "month" } })).toBe("bucket only applies to time fields")
    expect(first(tomoe.Series, { from: "customers", by: { field: "country" } })).toBeNull()
  })

  it("caps rows at the source's maxRows", () => {
    expect(first(tomoe.Query, { from: "orders", limit: 5001 })).not.toBeNull()
  })
})
