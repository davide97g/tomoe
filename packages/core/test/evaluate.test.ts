import { describe, expect, it } from "vitest"

import { addMonths, bucketStart, codeRows, series, value } from "../src/index.ts"
import { ctx } from "./fixtures.ts"

describe("evaluation", () => {
  it("reduces queries to numbers", () => {
    expect(value({ from: "orders", where: [{ field: "status", op: "eq", value: "open" }], measure: { op: "count" } }, ctx)).toBe(2)
    expect(value({ from: "orders", window: { last: { months: 6 } }, where: [{ field: "status", op: "ne", value: "refunded" }], measure: { op: "sum", field: "total" } }, ctx)).toBe(475.4)
    expect(value(42, ctx)).toBe(42)
  })

  it("fills every bucket of the window", () => {
    const points = series({ from: "orders", window: { last: { months: 6 } }, by: { field: "created_at", bucket: "month" }, measure: { op: "sum", field: "total" } }, ctx)
    expect(points?.map((p) => p.key)).toEqual(["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"])
    expect(points?.find((p) => p.key === "2026-06-01")?.value).toBe(0)
  })

  it("sorts groups largest first", () => {
    expect(series({ from: "orders", by: { field: "channel" } }, ctx)).toEqual([
      { key: "web", value: 3 },
      { key: "app", value: 1 },
      { key: "store", value: 1 },
    ])
  })

  it("hands custom code only selected fields, sensitive ones null in privacy mode", () => {
    const q = { from: "orders", select: ["id", "total"], limit: 1 }
    expect(codeRows(q, ctx, false)).toEqual([{ id: "o-1", total: 120.5 }])
    expect(codeRows(q, ctx, true)).toEqual([{ id: "o-1", total: null }])
  })

  it("tells a missing source apart from zero", () => {
    const down = { ...ctx, rows: () => null }
    expect(value({ from: "orders", measure: { op: "count" } }, down)).toBeNull()
  })

  it("does date arithmetic on ISO dates", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28")
    expect(bucketStart("2026-10-15", "week")).toBe("2026-10-12")
    expect(bucketStart("2026-08-20", "quarter")).toBe("2026-07-01")
  })
})
