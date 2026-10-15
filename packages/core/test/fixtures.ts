import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { type Context, createTomoe } from "../src/index.ts"

export const ROOT = resolve(import.meta.dirname, "../../..")
const read = (f: string) => JSON.parse(readFileSync(resolve(ROOT, "examples/shop", f), "utf8"))
export const manifestJson = () => read("manifest.json")
export const widgetJson = () => read("widget.json")
export const tomoe = createTomoe(manifestJson())
const rows = read("rows.json") as Record<string, Record<string, unknown>[]>
export const ctx: Context = { manifest: tomoe.manifest, today: "2026-10-15", rows: (s) => rows[s] ?? null }
