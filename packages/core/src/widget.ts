/**
 * Widgets (references/blueprint.md §6–7): a declarative spec, a flat map of elements drawn from the
 * catalog, or custom code for the sandbox with the queries it reads. Validated the same way when the
 * agent proposes one, when the client saves it and when the board is loaded.
 */
import { z } from "zod"

import type { Catalog, ComponentType } from "./catalog.ts"
import type { Queries, Query } from "./query.ts"

export const MAX_ELEMENTS = 40
export const MAX_DEPTH = 8
export const MAX_CUSTOM_CODE = 60_000
export const MAX_CUSTOM_QUERIES = 12
export const WIDGET_SIZES = ["small", "medium", "large", "full"] as const

export const ElementId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "element ids are lowercase letters, digits, - and _")
export const WidgetId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, "widget ids are lowercase kebab-case")
const DataName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, "data names are letters, digits and _")
const Title = z.string().trim().min(1).max(120)

export type WidgetElement = { type: ComponentType; props: Record<string, unknown>; children: string[] }
export type WidgetSpec = { root: string; elements: Record<string, WidgetElement> }
export type WidgetSize = (typeof WIDGET_SIZES)[number]
export type SpecWidget = { id: string; title: string; size: WidgetSize; kind: "spec"; spec: WidgetSpec }
export type CustomWidget = { id: string; title: string; size: WidgetSize; kind: "custom"; data: Record<string, Query>; code: string }
export type WidgetInput = SpecWidget | CustomWidget
export type Widget = WidgetInput & { created: string; updated: string }
export type Board = { version: 1; widgets: Widget[] }
export const EMPTY_BOARD: Board = { version: 1, widgets: [] }

export function buildSpec(catalog: Catalog): z.ZodType<WidgetSpec> {
  const types = Object.keys(catalog) as ComponentType[]
  const RawElement = z.object({ type: z.string(), props: z.record(z.string(), z.unknown()).optional(), children: z.array(ElementId).max(MAX_ELEMENTS).optional() }).strict()
  return z
    .object({
      root: ElementId,
      elements: z.record(ElementId, RawElement).refine((e) => Object.keys(e).length <= MAX_ELEMENTS, `at most ${MAX_ELEMENTS} elements`),
    })
    .strict()
    .transform((spec, ctx) => {
      let bad = false
      const problem = (message: string) => {
        bad = true
        ctx.addIssue({ code: "custom", message })
      }
      const elements: Record<string, WidgetElement> = {}
      for (const [id, el] of Object.entries(spec.elements)) {
        const component = catalog[el.type as ComponentType]
        if (!component) {
          problem(`${id}: unknown type "${el.type}" (known: ${types.join(", ")})`)
          continue
        }
        const props = component.props.safeParse(el.props ?? {})
        if (!props.success) {
          const issue = props.error.issues[0]
          problem(`${id} (${el.type}): ${issue.path.join(".") || "props"}: ${issue.message}`)
          continue
        }
        const children = el.children ?? []
        if (children.length && !component.children) problem(`${id} (${el.type}) takes no children`)
        for (const c of children) if (!spec.elements[c]) problem(`${id}: child "${c}" is not an element`)
        elements[id] = { type: el.type as ComponentType, props: props.data, children }
      }
      if (!spec.elements[spec.root]) problem(`root "${spec.root}" is not an element`)
      if (bad) return z.NEVER
      // Each element shown once, no cycles, not too deep.
      const seen = new Set<string>()
      const walk = (id: string, depth: number): boolean => {
        if (seen.has(id) || depth > MAX_DEPTH) return false
        seen.add(id)
        return elements[id].children.every((c) => walk(c, depth + 1))
      }
      if (!walk(spec.root, 1)) {
        problem(`elements form a cycle, are used twice or nest deeper than ${MAX_DEPTH}`)
        return z.NEVER
      }
      // Elements the root never reaches are dropped.
      return { root: spec.root, elements: Object.fromEntries(Object.entries(elements).filter(([id]) => seen.has(id))) }
    }) as unknown as z.ZodType<WidgetSpec>
}

/**
 * What custom code must not contain. Not the security boundary (the sandbox is: worker, CSP, sanitizer);
 * it refuses the obvious attempts before anything runs, with a reason the agent can act on.
 */
const FORBIDDEN: [RegExp, string][] = [
  [/\b(?:https?|wss?|ftp|javascript|blob):/i, "no URLs or URL schemes"],
  [/\/\/[a-z0-9-]+\.[a-z]{2,}\//i, "no addresses"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|importScripts|SharedWorker|serviceWorker|indexedDB|caches)\b|\bnew\s+Worker\b/, "no network, storage or workers"],
  [/\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]/, "no eval or dynamic code"],
]

/** The first rule custom code breaks, or null. */
export function customCodeProblem(code: string): string | null {
  for (const [re, why] of FORBIDDEN) {
    const m = re.exec(code)
    if (m) return `${why} (found "${m[0].slice(0, 30)}")`
  }
  return null
}

export type Widgets = {
  Spec: z.ZodType<WidgetSpec>
  WidgetInput: z.ZodType<WidgetInput>
  Widget: z.ZodType<Widget>
  parseWidget: (value: unknown) => { widget: WidgetInput } | { error: string }
}

/** Widgets saved before `kind` existed are specs. */
const withKind = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) && !("kind" in v) ? { ...v, kind: "spec" } : v)

export function buildWidgets(catalog: Catalog, q: Queries): Widgets {
  const Spec = buildSpec(catalog)
  const Size = z.enum(WIDGET_SIZES).default("medium")
  const Code = z
    .string()
    .min(1)
    .max(MAX_CUSTOM_CODE, `at most ${MAX_CUSTOM_CODE} characters`)
    .superRefine((code, ctx) => {
      const problem = customCodeProblem(code)
      if (problem) ctx.addIssue({ code: "custom", message: problem })
    })
  const SpecInput = z.object({ id: WidgetId, title: Title, size: Size, kind: z.literal("spec"), spec: Spec }).strict()
  const CustomInput = z
    .object({
      id: WidgetId,
      title: Title,
      size: Size,
      kind: z.literal("custom"),
      /** Named queries: the sandbox receives their rows as `ac.data.<name>`. */
      data: z.record(DataName, q.Query).refine((d) => Object.keys(d).length <= MAX_CUSTOM_QUERIES, `at most ${MAX_CUSTOM_QUERIES} data queries`).default({}),
      code: Code,
    })
    .strict()
  const WidgetInput = z.preprocess(withKind, z.discriminatedUnion("kind", [SpecInput, CustomInput])) as unknown as z.ZodType<WidgetInput>
  const Stamps = { created: z.string(), updated: z.string() }
  const Widget = z.preprocess(withKind, z.discriminatedUnion("kind", [SpecInput.extend(Stamps).strip(), CustomInput.extend(Stamps).strip()])) as unknown as z.ZodType<Widget>
  const parseWidget = (value: unknown): { widget: WidgetInput } | { error: string } => {
    const r = WidgetInput.safeParse(value)
    if (r.success) return { widget: r.data }
    const issue = r.error.issues[0]
    const where = issue.path.filter((p) => p !== "spec" && p !== "elements").join(".")
    return { error: `${where ? `${where}: ` : ""}${issue.message}` }
  }
  return { Spec, WidgetInput, Widget, parseWidget }
}

/** A widget as stored and as written in blocks: fixed key order, so equal widgets give equal JSON. */
export function widgetFields(w: WidgetInput): WidgetInput {
  return w.kind === "custom"
    ? { id: w.id, title: w.title, size: w.size, kind: "custom", data: w.data, code: w.code }
    : { id: w.id, title: w.title, size: w.size, kind: "spec", spec: w.spec }
}

export function widgetJson(w: WidgetInput): string {
  return JSON.stringify(widgetFields(w))
}

/** A board read from storage: a widget that no longer validates is skipped (reported), not the whole board. */
export function loadBoard(raw: unknown, Widget: z.ZodType<Widget>, report: (id: string, why: string) => void = () => {}): Board {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { widgets?: unknown }).widgets) ? (raw as { widgets: unknown[] }).widgets : []
  const widgets = list.flatMap((w) => {
    const r = Widget.safeParse(w)
    if (!r.success) report(String((w as { id?: unknown })?.id ?? "?"), r.error.issues[0]?.message ?? "invalid")
    return r.success ? [r.data] : []
  })
  return { version: 1, widgets }
}

/** Every query a widget reads, for "this widget reads X" and for loading sources on demand. */
export function widgetQueries(w: WidgetInput): Query[] {
  if (w.kind === "custom") return Object.values(w.data)
  const out: Query[] = []
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return
    if (Array.isArray(v)) return v.forEach(visit)
    if (typeof (v as { from?: unknown }).from === "string") out.push(v as Query)
    else Object.values(v).forEach(visit)
  }
  for (const el of Object.values(w.spec.elements)) visit(el.props)
  return out
}
