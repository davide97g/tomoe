// Smoke run on the made-up shop: manifest → schemas → a widget proposal → its numbers.
import { readFileSync } from "node:fs"

import { type Context, createTomoe, series, type Series, type Value, value } from "../../packages/core/src/index.ts"

const read = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"))
const tomoe = createTomoe(read("./manifest.json"))
const rows = read("./rows.json") as Record<string, Record<string, unknown>[]>
const ctx: Context = { manifest: tomoe.manifest, today: "2026-10-15", rows: (s) => rows[s] ?? null }

const answer = "Here is your orders widget.\n\n```widget\n" + JSON.stringify(read("./widget.json")) + "\n```"
console.log(tomoe.finish(answer, "text"), "\n")

const r = tomoe.parseWidget(read("./widget.json"))
if ("error" in r) throw new Error(r.error)
if (r.widget.kind !== "spec") throw new Error("expected a spec")
const els = r.widget.spec.elements
console.log("open orders:", value((els.open.props as { value: Value }).value, ctx))
console.log("revenue, 6 months:", value((els.revenue.props as { value: Value }).value, ctx))
console.log("by month:", series(els.chart.props.series as Series, ctx))
console.log("\nprompt:", tomoe.instructions().length, "characters")
