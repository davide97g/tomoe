/**
 * The component catalog (references/blueprint.md §6.2): each component's props as a strict Zod schema
 * and the line that describes it to the agent, side by side so they cannot drift apart. Data props
 * take queries from query.ts; field and action names are checked against the manifest.
 */
import { z } from "zod"

import { type Manifest, placeholders, type Source } from "./manifest.ts"
import type { Queries, Query } from "./query.ts"

export const COMPONENT_TYPES = ["Grid", "Stack", "Section", "Heading", "Text", "Callout", "Separator", "Metric", "Progress", "Chart", "Table", "List", "Countdown", "Button"] as const
export type ComponentType = (typeof COMPONENT_TYPES)[number]
export type ComponentDef = { children: boolean; props: z.ZodType<Record<string, unknown>>; doc: string }
export type Catalog = Record<ComponentType, ComponentDef>

export const FORMATS = ["number", "money", "percent", "days"] as const
export const TONES = ["info", "success", "warning", "danger"] as const

/** What a Button or a custom widget asks the host to do: open one of its screens, or offer a question. */
export type OpenTarget = { action: string; params?: Record<string, string> }
export type WidgetAction = ({ type: "open" } & OpenTarget) | { type: "ask"; question: string }

const Title = z.string().trim().min(1).max(120)
const Label = z.string().trim().min(1).max(80)
const Text = z.string().trim().min(1).max(2000)

export function buildOpenTarget(m: Manifest): z.ZodType<OpenTarget> {
  const ids = m.actions.map((a) => a.id)
  return z
    .object({ action: z.string(), params: z.record(z.string().max(40), z.string().min(1).max(200)).refine((p) => Object.keys(p).length <= 10, "at most 10 params").optional() })
    .strict()
    .superRefine((t, ctx) => {
      const a = m.actions.find((x) => x.id === t.action)
      if (!a) return ctx.addIssue({ code: "custom", path: ["action"], message: `unknown action "${t.action}" (${ids.join("|") || "none"})` })
      for (const p of placeholders(a.target)) if (!t.params?.[p]) ctx.addIssue({ code: "custom", path: ["params", p], message: `${a.id} needs param "${p}"` })
    }) as unknown as z.ZodType<OpenTarget>
}

export function buildCatalog(m: Manifest, q: Queries): Catalog {
  const source = (id: string): Source | undefined => m.sources.find((s) => s.id === id)
  const fieldCheck = (query: Query, names: (string | undefined)[], path: string[], ctx: z.RefinementCtx) => {
    const s = source(query.from)
    if (!s) return
    names.forEach((n, i) => {
      if (n !== undefined && !s.fields.some((f) => f.name === n)) ctx.addIssue({ code: "custom", path: [path[i] ?? path[0]], message: `"${n}" is not a field of ${s.id} (${s.fields.map((f) => f.name).join("|")})` })
    })
  }
  const OpenTarget = buildOpenTarget(m)
  const Action = z.union([
    z.object({ type: z.literal("open"), action: z.string(), params: z.record(z.string(), z.string()).optional() }).strict().superRefine((a, ctx) => {
      const r = OpenTarget.safeParse({ action: a.action, params: a.params })
      if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", path: i.path, message: i.message })
    }),
    z.object({ type: z.literal("ask"), question: z.string().trim().min(1).max(500) }).strict(),
  ])
  const Format = z.enum(FORMATS).optional()
  const props = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()
  const def = (children: boolean, schema: z.ZodType, doc: string): ComponentDef => ({ children, props: schema as z.ZodType<Record<string, unknown>>, doc })

  return {
    Grid: def(true, props({ columns: z.number().int().min(1).max(4).optional() }), "{columns?: 1-4} children side by side (one column on phones)."),
    Stack: def(true, props({ direction: z.enum(["row", "column"]).optional(), gap: z.enum(["sm", "md", "lg"]).optional() }), `{direction?: "row"|"column", gap?: "sm"|"md"|"lg"} children in a line.`),
    Section: def(true, props({ title: Title, description: z.string().max(300).optional() }), "{title, description?} a titled group of children."),
    Heading: def(false, props({ text: Title }), "{text}."),
    Text: def(false, props({ text: Text, muted: z.boolean().optional() }), "{text, muted?} Markdown, in the user's language."),
    Callout: def(false, props({ tone: z.enum(TONES), title: Title.optional(), text: Text }), `{tone: ${TONES.map((t) => `"${t}"`).join("|")}, title?, text}.`),
    Separator: def(false, props({}), "{}."),
    Metric: def(false, props({ label: Label, value: q.Value, format: Format, hint: z.string().max(200).optional() }), `{label, value, format?: ${FORMATS.map((f) => `"${f}"`).join("|")}, hint?} one big number.`),
    Progress: def(false, props({ label: Label, value: q.Value, max: q.Value, format: Format }), "{label, value, max, format?} a bar from value to max."),
    Chart: def(
      false,
      props({ kind: z.enum(["bar", "line", "area", "donut"]), series: q.Series, height: z.enum(["sm", "md", "lg"]).optional(), cumulative: z.boolean().optional() }),
      `{kind: "bar"|"line"|"area"|"donut", series, height?: "sm"|"md"|"lg", cumulative?} series = a query plus "by" and "measure"?.`
    ),
    Table: def(
      false,
      props({ query: q.Query, columns: z.array(z.string()).min(1).max(8), limit: z.number().int().min(1).max(100).optional(), empty: z.string().max(200).optional() }).superRefine((p, ctx) =>
        fieldCheck(p.query as Query, p.columns as string[], ["columns"], ctx)
      ),
      "{query, columns: [field, ...] (1-8), limit?: 1-100, empty?} rows as a table; sensitive fields are masked in privacy mode."
    ),
    List: def(
      false,
      props({
        query: q.Query,
        title: z.string(),
        subtitle: z.string().optional(),
        badge: z.string().optional(),
        action: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        empty: z.string().max(200).optional(),
      }).superRefine((p, ctx) => {
        const query = p.query as Query
        fieldCheck(query, [p.title as string, p.subtitle as string | undefined, p.badge as string | undefined], ["title", "subtitle", "badge"], ctx)
        if (p.action !== undefined) {
          const a = m.actions.find((x) => x.id === p.action)
          if (!a || a.source !== query.from) ctx.addIssue({ code: "custom", path: ["action"], message: `"${String(p.action)}" is not an action on ${query.from} rows (${m.actions.filter((x) => x.source === query.from).map((x) => x.id).join("|") || "none"})` })
        }
      }),
      "{query, title: field, subtitle?: field, badge?: field, action?: action id on that source's rows, limit?: 1-50, empty?} a list; each row opens the action."
    ),
    Countdown: def(
      false,
      props({ query: q.Query, label: Label.optional() }).superRefine((p, ctx) => {
        const query = p.query as Query
        const s = source(query.from)
        if (s && !(query.window?.field ?? s.time)) ctx.addIssue({ code: "custom", path: ["query"], message: `${s.id} has no time field to count down to` })
      }),
      "{query, label?} days until the first row of the query from today on (by its time field)."
    ),
    Button: def(false, props({ label: Label, action: Action }), `{label, action} action: {"type": "open", "action": "<action id>", "params"?: {...}} | {"type": "ask", "question"} (asks you in the chat).`),
  }
}
