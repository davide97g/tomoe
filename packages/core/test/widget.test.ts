import { describe, expect, it } from "vitest"

import { customCodeProblem, widgetJson as toJson, widgetQueries } from "../src/index.ts"
import { tomoe, widgetJson } from "./fixtures.ts"

const spec = (elements: Record<string, unknown>, root = "main") => ({ id: "w", title: "W", spec: { root, elements } })

describe("widgets", () => {
  it("parses the example and defaults kind and size", () => {
    const r = tomoe.parseWidget(widgetJson())
    expect(r).toHaveProperty("widget")
    if (!("widget" in r)) return
    expect(r.widget.kind).toBe("spec")
    expect(widgetQueries(r.widget).map((q) => q.from)).toEqual(["orders", "orders", "orders", "orders"])
    expect(toJson(r.widget)).toBe(toJson(r.widget))
  })

  it("explains what is wrong, for the agent", () => {
    expect(tomoe.parseWidget(spec({ main: { type: "Pie" } }))).toEqual({ error: expect.stringContaining('main: unknown type "Pie" (known: Grid, Stack') })
    expect(tomoe.parseWidget(spec({ main: { type: "Heading", props: { text: "x" }, children: ["b"] }, b: { type: "Separator" } }))).toEqual({ error: "main (Heading) takes no children" })
    expect(tomoe.parseWidget(spec({ main: { type: "Stack", children: ["b"] }, b: { type: "Stack", children: ["main"] } }))).toEqual({ error: expect.stringContaining("cycle") })
    expect(tomoe.parseWidget(spec({ main: { type: "Table", props: { query: { from: "orders" }, columns: ["id", "price"] } } }))).toEqual({ error: expect.stringContaining('"price" is not a field of orders') })
    expect(tomoe.parseWidget(spec({ main: { type: "List", props: { query: { from: "customers" }, title: "name", action: "open-order" } } }))).toEqual({ error: expect.stringContaining('"open-order" is not an action on customers rows') })
    expect(tomoe.parseWidget(spec({ main: { type: "Button", props: { label: "Go", action: { type: "open", action: "open-order" } } } }))).toEqual({ error: expect.stringContaining('open-order needs param "id"') })
  })

  it("drops elements the root never reaches", () => {
    const r = tomoe.parseWidget(spec({ main: { type: "Heading", props: { text: "Hi" } }, lost: { type: "Separator" } }))
    expect("widget" in r && r.widget.kind === "spec" && Object.keys(r.widget.spec.elements)).toEqual(["main"])
  })

  it("refuses obvious escapes in custom code", () => {
    expect(customCodeProblem("ac.onUpdate(() => ac.render('<b>hi</b>'))")).toBeNull()
    for (const bad of ["fetch('/x')", "new Worker('a')", "eval('1')", "Function('return 1')", "import('x')", "setTimeout('alert(1)')", "'https://x.example/'", "x = '//evil.com/'"]) {
      expect(customCodeProblem(bad), bad).not.toBeNull()
    }
    const r = tomoe.parseWidget({ id: "c", title: "C", kind: "custom", data: { orders: { from: "orders", select: ["created_at"] } }, code: "navigator.sendBeacon(1)" })
    expect(r).toEqual({ error: expect.stringContaining("no network") })
  })

  it("loads a board, skipping a widget that no longer validates", () => {
    const stamps = { created: "2026-10-15T00:00:00Z", updated: "2026-10-15T00:00:00Z" }
    const skipped: string[] = []
    const board = tomoe.loadBoard({ version: 1, widgets: [{ ...widgetJson(), ...stamps }, { ...spec({ main: { type: "Gone" } }), id: "old", ...stamps }] }, (id) => skipped.push(id))
    expect(board.widgets.map((w) => w.id)).toEqual(["orders-6-months"])
    expect(skipped).toEqual(["old"])
  })
})
