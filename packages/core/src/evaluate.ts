/**
 * Runs queries over rows already fetched from the host (an adapter's job, capped by `maxRows`). The
 * same code serves the declarative renderer, the custom widgets' data and the agent's `run_query`.
 */
import { fieldOf, type Manifest, sourceOf, type Source } from "./manifest.ts"
import type { Aggregate, Bucket, Condition, Measure, Query, Series, Span, Value } from "./query.ts"

export type Row = Record<string, unknown>
export type Context = {
  manifest: Manifest
  /** YYYY-MM-DD, in the user's time zone. */
  today: string
  /** A source's rows; null when that source is not available (not connected, down). */
  rows: (source: string) => Row[] | null
}
export type Point = { key: string; value: number }

// ---------- dates (ISO strings, UTC arithmetic) ----------

const utc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
export function addDays(date: string, n: number): string {
  const d = utc(date)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
export function addMonths(date: string, n: number): string {
  const d = utc(date)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return iso(d)
}
const shift = (date: string, span: Span, sign: 1 | -1) => addDays(addMonths(date, sign * (span.months ?? 0)), sign * (span.days ?? 0))

/** First day of the bucket a date falls in (weeks start on Monday). */
export function bucketStart(date: string, bucket: Bucket): string {
  const d = date.slice(0, 10)
  switch (bucket) {
    case "day":
      return d
    case "week":
      return addDays(d, -((utc(d).getUTCDay() + 6) % 7))
    case "month":
      return `${d.slice(0, 7)}-01`
    case "quarter":
      return `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`
    case "year":
      return `${d.slice(0, 4)}-01-01`
  }
}
const nextBucket = (start: string, bucket: Bucket) =>
  bucket === "day" ? addDays(start, 1) : bucket === "week" ? addDays(start, 7) : addMonths(start, bucket === "month" ? 1 : bucket === "quarter" ? 3 : 12)

// ---------- rows ----------

const empty = (v: unknown) => v === null || v === undefined || v === ""
const lower = (v: unknown) => String(v).toLowerCase()

function matches(row: Row, c: Condition): boolean {
  const v = row[c.field]
  switch (c.op) {
    case "empty":
      return empty(v)
    case "present":
      return !empty(v)
    case "eq":
      return v === c.value
    case "ne":
      return v !== c.value
    case "in":
      return (c.value as unknown[]).includes(v)
    case "contains":
      return typeof v === "string" && lower(v).includes(lower(c.value))
    default: {
      if (empty(v)) return false
      const a = v as string | number
      const b = c.value as string | number
      return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b
    }
  }
}

/** [start, end] of a query's window (dates), or null when it has none. */
export function windowRange(q: Query, today: string): [string, string] | null {
  if (!q.window) return null
  return [q.window.last ? shift(today, q.window.last, -1) : today, q.window.next ? shift(today, q.window.next, 1) : today]
}

/** The rows a query selects, filtered, sorted and capped; null when the source is not available. */
export function selectRows(q: Query, ctx: Context): Row[] | null {
  const s = sourceOf(ctx.manifest, q.from)
  const all = ctx.rows(s.id)
  if (!all) return null
  const range = windowRange(q, ctx.today)
  const time = q.window?.field ?? s.time
  let rows = all.filter((r) => {
    if (range && time) {
      const t = r[time]
      if (typeof t !== "string") return false
      const d = t.slice(0, 10)
      if (d < range[0] || d > range[1]) return false
    }
    return (q.where ?? []).every((c) => matches(r, c))
  })
  if (q.sort) {
    const { field, dir } = q.sort
    const sign = dir === "desc" ? -1 : 1
    rows = [...rows].sort((a, b) => {
      const x = a[field] as string | number
      const y = b[field] as string | number
      if (empty(x)) return 1
      if (empty(y)) return -1
      return x < y ? -sign : x > y ? sign : 0
    })
  }
  return rows.slice(0, Math.min(q.limit ?? s.maxRows, s.maxRows))
}

const round = (n: number) => Math.round(n * 100) / 100

function reduce(rows: Row[], m: Measure): number | null {
  if (m.op === "count") return rows.length
  const nums = rows.map((r) => r[m.field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  if (m.op === "sum") return round(nums.reduce((a, b) => a + b, 0))
  if (!nums.length) return null
  if (m.op === "avg") return round(nums.reduce((a, b) => a + b, 0) / nums.length)
  return m.op === "min" ? Math.min(...nums) : Math.max(...nums)
}

/** A Value as a number; null when its source is not available or there is nothing to reduce. */
export function value(v: Value, ctx: Context): number | null {
  if (typeof v === "number") return v
  const rows = selectRows(v as Aggregate, ctx)
  return rows ? reduce(rows, v.measure) : null
}

/** A chart's points: time buckets ascending (empty ones of the window filled in), other groups largest first. */
export function series(q: Series, ctx: Context, cumulative = false): Point[] | null {
  const s = sourceOf(ctx.manifest, q.from)
  const rows = selectRows({ ...q, limit: undefined, sort: undefined }, ctx)
  if (!rows) return null
  const f = fieldOf(s, q.by.field)!
  const time = f.role === "time"
  const bucket = q.by.bucket ?? "month"
  const groups = new Map<string, Row[]>()
  const range = windowRange(q, ctx.today)
  if (time && range) for (let b = bucketStart(range[0], bucket); b <= range[1]; b = nextBucket(b, bucket)) groups.set(b, [])
  for (const r of rows) {
    const v = r[f.name]
    if (time && typeof v !== "string") continue
    const key = time ? bucketStart(v as string, bucket) : empty(v) ? "—" : String(v)
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const measure = q.measure ?? { op: "count" }
  const points = [...groups].map(([key, rs]) => ({ key, value: reduce(rs, measure) ?? 0 }))
  points.sort(time ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.value - a.value)
  if (q.limit && !time) points.splice(q.limit)
  if (cumulative) {
    let run = 0
    for (const p of points) p.value = round((run += p.value))
  }
  return points
}

/**
 * The rows custom code receives: only the selected fields, sensitive ones null in privacy mode (the
 * code cannot show what it never gets); null when the source is not available.
 */
export function codeRows(q: Query, ctx: Context, privacy: boolean): Row[] | null {
  const s: Source = sourceOf(ctx.manifest, q.from)
  const rows = selectRows(q, ctx)
  if (!rows) return null
  const fields = (q.select ?? s.fields.map((f) => f.name)).map((n) => fieldOf(s, n)!)
  return rows.map((r) => Object.fromEntries(fields.map((f) => [f.name, privacy && f.sensitive ? null : (r[f.name] ?? null)])))
}

export function customData(data: Record<string, Query>, ctx: Context, privacy: boolean): Record<string, Row[] | null> {
  return Object.fromEntries(Object.entries(data).map(([name, q]) => [name, codeRows(q, ctx, privacy)]))
}
