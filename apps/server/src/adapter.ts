/**
 * The host adapter (references/blueprint.md §5.2 "Execution"): fetches a source's rows from the host,
 * read-only by construction. REST sources are GET requests to the connection's backend origin only (no
 * redirects, no other host), with the user's own headers, a timeout, a page cap and `maxRows`; the
 * rows keep only the manifest's fields, coerced to their types. "memory" sources are rows kept by
 * Tomoe (data files, the example). GraphQL, SQL and MCP origins are not wired yet: their sources show
 * as not available, never as empty.
 */
import type { Field, Manifest, Row, Source } from "@tomoe/core"

import type { Connection } from "./store.ts"

const TIMEOUT_MS = 10_000
const MAX_PAGES = 50
const PAGE_SIZE = 100
const MAX_BYTES = 20_000_000
const CACHE_MS = 30_000

export type Fetched = { rows: Row[] | null; error?: string }

/** A GET on the backend's origin, or an error; never follows a redirect. */
export async function hostGet(conn: Connection, path: string, extra: { maxBytes?: number; accept?: string } = {}): Promise<{ status: number; type: string; body: string }> {
  if (!conn.url) throw new Error("no backend URL is connected")
  const base = new URL(conn.url)
  const url = new URL(path, base)
  if (url.origin !== base.origin) throw new Error(`only ${base.origin} can be read`)
  const r = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: extra.accept ?? "application/json", ...conn.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const max = extra.maxBytes ?? MAX_BYTES
  const reader = r.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) {
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
  }
  return { status: r.status, type: r.headers.get("content-type") ?? "", body: Buffer.concat(chunks).toString("utf8") }
}

/** The list inside a response: the body itself, or its first array of objects (data, items, results…). */
export function rowsOf(body: unknown): Row[] | null {
  const isRows = (v: unknown): v is Row[] => Array.isArray(v) && v.every((x) => x !== null && typeof x === "object" && !Array.isArray(x))
  if (isRows(body)) return body
  if (!body || typeof body !== "object") return null
  const o = body as Record<string, unknown>
  for (const k of ["data", "items", "results", "rows", "records", "content", "entries", "list"]) {
    if (isRows(o[k])) return o[k]
    const inner = o[k] && typeof o[k] === "object" ? rowsOf(o[k]) : null
    if (inner) return inner
  }
  for (const v of Object.values(o)) if (isRows(v) && v.length) return v
  return null
}

function nextCursor(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const o = body as Record<string, unknown>
  for (const k of ["next_cursor", "nextCursor", "cursor", "next"]) {
    const v = o[k]
    if (typeof v === "string" && v && !v.includes("://")) return v
    if (typeof v === "number") return String(v)
  }
  const meta = o.meta ?? o.pagination ?? o.page_info ?? o.pageInfo
  return meta && meta !== body ? nextCursor(meta) : null
}

/** A value as the manifest's type says, or null. */
export function coerce(f: Field, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null
  switch (f.type) {
    case "number":
    case "integer": {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.eE+-]/g, "")) : NaN
      return Number.isFinite(n) ? (f.type === "integer" ? Math.round(n) : n) : null
    }
    case "boolean":
      return typeof v === "boolean" ? v : v === "true" || v === 1 || v === "1" ? true : v === "false" || v === 0 || v === "0" ? false : null
    case "date":
    case "datetime": {
      if (typeof v === "number") {
        const d = new Date(v < 1e11 ? v * 1000 : v)
        return Number.isNaN(d.getTime()) ? null : f.type === "date" ? d.toISOString().slice(0, 10) : d.toISOString()
      }
      if (typeof v !== "string") return null
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return f.type === "date" ? v.slice(0, 10) : v
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? null : f.type === "date" ? d.toISOString().slice(0, 10) : d.toISOString()
    }
    default:
      return typeof v === "object" ? JSON.stringify(v).slice(0, 500) : String(v)
  }
}

/** Only the declared fields, typed. A field may be read from a dotted path ("customer.name" style keys are not split). */
export function shape(s: Source, rows: Row[]): Row[] {
  return rows.slice(0, s.maxRows).map((r) => Object.fromEntries(s.fields.map((f) => [f.name, coerce(f, r[f.name])])))
}

async function restRows(conn: Connection, s: Source & { origin: { kind: "rest" } }): Promise<Row[]> {
  const out: Row[] = []
  const withParams = (params: Record<string, string>) => {
    const u = new URL(s.origin.path, "http://x")
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return u.pathname + u.search
  }
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES && out.length < s.maxRows; page++) {
    const p = s.origin.pagination
    const path =
      p === "page" ? withParams({ page: String(page + 1), per_page: String(PAGE_SIZE), limit: String(PAGE_SIZE) })
      : p === "offset" ? withParams({ offset: String(out.length), limit: String(PAGE_SIZE) })
      : p === "cursor" && cursor ? withParams({ cursor })
      : s.origin.path
    const r = await hostGet(conn, path)
    if (r.status >= 400) throw new Error(`GET ${path}: HTTP ${r.status}`)
    let body: unknown
    try {
      body = JSON.parse(r.body)
    } catch {
      throw new Error(`GET ${path}: not JSON`)
    }
    const rows = rowsOf(body)
    if (!rows) throw new Error(`GET ${path}: no list of rows in the response`)
    out.push(...rows)
    if (p === "none" || !rows.length) break
    if (p === "cursor") {
      cursor = nextCursor(body)
      if (!cursor) break
    }
  }
  return out
}

/** Reads sources for one app, with a short cache keyed by source. */
export class Adapter {
  private cache = new Map<string, { at: number; value: Promise<Fetched> }>()

  readonly connection: () => Connection
  readonly memory: (source: string) => Row[] | null

  constructor(connection: () => Connection, memory: (source: string) => Row[] | null) {
    this.connection = connection
    this.memory = memory
  }

  clear() {
    this.cache.clear()
  }

  rows(m: Manifest, sourceId: string, fresh = false): Promise<Fetched> {
    const s = m.sources.find((x) => x.id === sourceId)
    if (!s) return Promise.resolve({ rows: null, error: `unknown source "${sourceId}"` })
    const key = `${sourceId}:${JSON.stringify(s.origin)}`
    const hit = this.cache.get(key)
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value
    const value = this.fetch(s).catch((e: Error) => ({ rows: null, error: e.message }))
    this.cache.set(key, { at: Date.now(), value })
    return value
  }

  private async fetch(s: Source): Promise<Fetched> {
    const o = s.origin
    if (o.kind === "memory") {
      const rows = this.memory(s.id)
      return rows ? { rows: shape(s, rows) } : { rows: null, error: "no rows stored for this source" }
    }
    if (o.kind === "rest") {
      if (!this.connection().url) return { rows: null, error: "no backend URL connected: add one in Connect" }
      return { rows: shape(s, await restRows(this.connection(), s as Source & { origin: { kind: "rest" } })) }
    }
    return { rows: null, error: `${o.kind} sources are not wired yet` }
  }
}
