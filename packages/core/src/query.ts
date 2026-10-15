/**
 * The query DSL (references/blueprint.md §5), generated per manifest: `from` is a union over the
 * sources, field names are enums of each source's fields, and operators, values, groupings and
 * measures are checked against each field's type and role. The agent cannot name a field that does
 * not exist, and the error says what would have been allowed.
 */
import { z } from "zod"

import { type Field, type FieldType, type Manifest, type Source } from "./manifest.ts"

export const OPS = ["eq", "ne", "in", "gt", "gte", "lt", "lte", "contains", "empty", "present"] as const
export type Op = (typeof OPS)[number]
export const BUCKETS = ["day", "week", "month", "quarter", "year"] as const
export type Bucket = (typeof BUCKETS)[number]
export const AGGREGATES = ["sum", "avg", "min", "max"] as const

export type Condition = { field: string; op: Op; value?: unknown }
export type Span = { days?: number; months?: number }
/** Rows whose time field falls in [today - last, today + next]; only `last` ends today, only `next` starts today. */
export type Window = { field?: string; last?: Span; next?: Span }
export type Query = { from: string; where?: Condition[]; window?: Window; select?: string[]; sort?: { field: string; dir?: "asc" | "desc" }; limit?: number }
export type Measure = { op: "count" } | { op: (typeof AGGREGATES)[number]; field: string }
/** A query reduced to one number. */
export type Aggregate = Query & { measure: Measure }
/** A query grouped into points; measure defaults to count. */
export type Series = Query & { by: { field: string; bucket?: Bucket }; measure?: Measure }
/** A number as is, or a query reduced to one. */
export type Value = number | Aggregate

export const OPS_BY_TYPE: Record<FieldType, Op[]> = {
  string: ["eq", "ne", "in", "contains", "empty", "present"],
  enum: ["eq", "ne", "in", "empty", "present"],
  number: ["eq", "ne", "in", "gt", "gte", "lt", "lte", "empty", "present"],
  integer: ["eq", "ne", "in", "gt", "gte", "lt", "lte", "empty", "present"],
  date: ["eq", "gt", "gte", "lt", "lte", "empty", "present"],
  datetime: ["gt", "gte", "lt", "lte", "empty", "present"],
  boolean: ["eq", "ne", "empty", "present"],
}
const GROUPABLE = new Set(["dimension", "time", "reference"])
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/

/** Why `v` is not a value of `f`, or null. */
function scalarProblem(f: Field, v: unknown): string | null {
  switch (f.type) {
    case "string":
      return typeof v === "string" && v.length <= 200 ? null : "a string (at most 200 characters)"
    case "enum":
      return typeof v === "string" && f.values?.includes(v) ? null : `one of ${f.values?.join("|")}`
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : "a number"
    case "integer":
      return Number.isInteger(v) ? null : "an integer"
    case "date":
      return typeof v === "string" && DATE.test(v) ? null : "a date YYYY-MM-DD"
    case "datetime":
      return typeof v === "string" && DATETIME.test(v) ? null : "an ISO date or date-time"
    case "boolean":
      return typeof v === "boolean" ? null : "true or false"
  }
}

type Ctx = z.RefinementCtx
const issue = (ctx: Ctx, path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message })

/** Checks that need the field's type and role: shared by every query shape. */
function check(s: Source, q: Query & { by?: Series["by"]; measure?: Measure }, ctx: Ctx) {
  const field = (name: string) => s.fields.find((f) => f.name === name)!
  q.where?.forEach((c, i) => {
    const f = field(c.field)
    const ops = OPS_BY_TYPE[f.type]
    if (!ops.includes(c.op)) return issue(ctx, ["where", i, "op"], `${s.id}.${f.name} (${f.type}) takes ${ops.join("|")}`)
    if (c.op === "empty" || c.op === "present") {
      if (c.value !== undefined) issue(ctx, ["where", i, "value"], `"${c.op}" takes no value`)
    } else if (c.op === "in") {
      if (!Array.isArray(c.value) || c.value.length < 1 || c.value.length > 50) return issue(ctx, ["where", i, "value"], `"in" takes a list of 1-50 values`)
      const bad = c.value.map((v) => scalarProblem(f, v)).find(Boolean)
      if (bad) issue(ctx, ["where", i, "value"], `${s.id}.${f.name}: each value must be ${bad}`)
    } else {
      const bad = scalarProblem(f, c.value)
      if (bad) issue(ctx, ["where", i, "value"], `${s.id}.${f.name}: value must be ${bad}`)
    }
  })
  if (q.window) {
    const name = q.window.field ?? s.time
    if (!name) issue(ctx, ["window", "field"], `${s.id} has no default time field: name one (${timeFields(s).join("|") || "none"})`)
    else if (field(name).role !== "time") issue(ctx, ["window", "field"], `${s.id}.${name} is not a time field (${timeFields(s).join("|") || "none"})`)
    if (!q.window.last && !q.window.next) issue(ctx, ["window"], "a window needs last, next or both")
  }
  if (q.measure && q.measure.op !== "count" && field(q.measure.field).role !== "measure") {
    issue(ctx, ["measure", "field"], `${s.id}.${q.measure.field} is not a measure (${measureFields(s).join("|") || "none"}); use {"op": "count"} to count rows`)
  }
  if (q.by) {
    const f = field(q.by.field)
    if (!GROUPABLE.has(f.role)) issue(ctx, ["by", "field"], `${s.id}.${f.name} cannot group (${groupFields(s).join("|") || "none"})`)
    if (q.by.bucket && f.role !== "time") issue(ctx, ["by", "bucket"], `bucket only applies to time fields`)
  }
}

export const timeFields = (s: Source) => s.fields.filter((f) => f.role === "time").map((f) => f.name)
export const measureFields = (s: Source) => s.fields.filter((f) => f.role === "measure").map((f) => f.name)
export const groupFields = (s: Source) => s.fields.filter((f) => GROUPABLE.has(f.role)).map((f) => f.name)

const Span = z
  .object({ days: z.number().int().min(0).max(3660).optional(), months: z.number().int().min(0).max(120).optional() })
  .strict()
  .refine((s) => s.days !== undefined || s.months !== undefined, "a span needs days or months")

function parts(s: Source) {
  const F = z.enum(s.fields.map((f) => f.name) as [string, ...string[]])
  const shape = {
    from: z.literal(s.id),
    where: z.array(z.object({ field: F, op: z.enum(OPS), value: z.unknown().optional() }).strict()).max(10).optional(),
    window: z.object({ field: F.optional(), last: Span.optional(), next: Span.optional() }).strict().optional(),
    /** Fields handed to custom code and tables (default: all). */
    select: z.array(F).min(1).max(40).optional(),
    sort: z.object({ field: F, dir: z.enum(["asc", "desc"]).optional() }).strict().optional(),
    limit: z.number().int().min(1).max(s.maxRows).optional(),
  }
  const measure = z.discriminatedUnion("op", [z.object({ op: z.literal("count") }).strict(), z.object({ op: z.enum(AGGREGATES), field: F }).strict()])
  const by = z.object({ field: F, bucket: z.enum(BUCKETS).optional() }).strict()
  return { shape, measure, by }
}

type Objects = [z.ZodObject, ...z.ZodObject[]]

export type Queries = {
  Query: z.ZodType<Query>
  Aggregate: z.ZodType<Aggregate>
  Series: z.ZodType<Series>
  Value: z.ZodType<Value>
}

/** Every query of an app with no sources: refused, with what to do instead. */
const NO_SOURCES = "no data source is connected: use static components, a custom widget with no data, or connect the app first"

export function buildQueries(m: Manifest): Queries {
  if (!m.sources.length) {
    const none = z.unknown().superRefine((_, ctx) => ctx.addIssue({ code: "custom", message: NO_SOURCES }))
    const number = z.unknown().superRefine((v, ctx) => {
      if (typeof v !== "number" || !Number.isFinite(v)) ctx.addIssue({ code: "custom", message: `a plain number (${NO_SOURCES})` })
    })
    return { Query: none as never, Aggregate: none as never, Series: none as never, Value: number as unknown as z.ZodType<Value> }
  }
  const each = (make: (s: Source) => z.ZodObject) => z.discriminatedUnion("from", m.sources.map(make) as Objects)
  const Query = each((s) => z.object(parts(s).shape).strict().superRefine((q, ctx) => check(s, q as Query, ctx)))
  const Aggregate = each((s) => {
    const p = parts(s)
    return z.object({ ...p.shape, measure: p.measure }).strict().superRefine((q, ctx) => check(s, q as Aggregate, ctx))
  })
  const Series = each((s) => {
    const p = parts(s)
    return z.object({ ...p.shape, by: p.by, measure: p.measure.optional() }).strict().superRefine((q, ctx) => check(s, q as Series, ctx))
  })
  return {
    Query: Query as unknown as z.ZodType<Query>,
    Aggregate: Aggregate as unknown as z.ZodType<Aggregate>,
    Series: Series as unknown as z.ZodType<Series>,
    Value: z.union([z.number(), Aggregate]) as unknown as z.ZodType<Value>,
  }
}
