/**
 * The Source Manifest: everything Tomoe knows about the host app (references/blueprint.md §4). The
 * discovery agent drafts it, deterministic probes check it, a human accepts it; every other schema
 * (queries, catalog, prompt, sandbox messages) is generated from it.
 */
import { z } from "zod"

export const FIELD_TYPES = ["string", "number", "integer", "boolean", "date", "datetime", "enum"] as const
export const FIELD_ROLES = ["id", "dimension", "measure", "time", "text", "reference"] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export type FieldRole = (typeof FIELD_ROLES)[number]

export const FieldName = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/, "field names are letters, digits and _")
export const SourceId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "source ids are lowercase letters, digits and _")
export const ActionId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "action ids are lowercase kebab-case")
const Label = z.string().trim().min(1).max(80)

export const Field = z
  .object({
    name: FieldName,
    /** Human name, in the user's language. */
    label: Label,
    type: z.enum(FIELD_TYPES),
    role: z.enum(FIELD_ROLES),
    /** Enums: the real values (from a probe). */
    values: z.array(z.string().min(1).max(80)).min(1).max(100).optional(),
    /** "currency:EUR", "percent", "seconds"… */
    unit: z.string().max(20).optional(),
    /** Personal or confidential: masked in privacy mode, null for custom code. */
    sensitive: z.boolean().default(false),
    description: z.string().max(300).optional(),
  })
  .strict()
export type Field = z.infer<typeof Field>

/** Where a source's rows come from. Read-only by construction: REST is GET only. */
export const Origin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rest"), method: z.literal("GET"), path: z.string().regex(/^\/(?!\/)\S{0,299}$/, "a path on the host"), pagination: z.enum(["none", "page", "cursor", "offset"]).default("none") }).strict(),
  z.object({ kind: z.literal("graphql"), query: z.string().min(1).max(5000) }).strict(),
  z.object({ kind: z.literal("sql"), table: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]{0,127}$/) }).strict(),
  z.object({ kind: z.literal("mcp"), tool: z.string().min(1).max(120) }).strict(),
  /** Rows handed to Tomoe directly: tests, demos, data the host already pushed. */
  z.object({ kind: z.literal("memory") }).strict(),
])

export const Source = z
  .object({
    id: SourceId,
    label: Label,
    description: z.string().max(500).default(""),
    origin: Origin,
    /** Primary key field. */
    key: FieldName,
    /** Default time field for windows. */
    time: FieldName.optional(),
    fields: z.array(Field).min(1).max(80),
    relations: z.array(z.object({ field: FieldName, to: SourceId }).strict()).max(20).default([]),
    maxRows: z.number().int().min(1).max(50_000).default(5_000),
  })
  .strict()
export type Source = z.infer<typeof Source>

/** A deep link into the host app; params fill `{placeholders}` in the target from a row of `source`. No mutations. */
export const Action = z
  .object({
    id: ActionId,
    label: Label,
    kind: z.literal("navigate"),
    target: z.string().regex(/^\/(?!\/)\S{0,299}$/, "a path on the host, like /orders/{id}"),
    source: SourceId.optional(),
    /** placeholder → field of `source` */
    params: z.record(FieldName, FieldName).default({}),
  })
  .strict()
export type Action = z.infer<typeof Action>

export const Refresh = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("poll"), seconds: z.number().int().min(15).max(86_400) }).strict(),
  z.object({ kind: z.literal("sse"), path: z.string().regex(/^\/(?!\/)\S{0,299}$/) }).strict(),
  z.object({ kind: z.literal("webhook") }).strict(),
])

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g
export const placeholders = (target: string) => [...target.matchAll(PLACEHOLDER)].map((m) => m[1])

export const Manifest = z
  .object({
    version: z.literal(1),
    app: z.object({ name: Label, description: z.string().max(1000).default(""), locale: z.string().regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/).default("en"), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict(),
    /** Empty: nothing connected yet (static widgets and creative mode only). */
    sources: z.array(Source).max(40),
    actions: z.array(Action).max(40).default([]),
    refresh: Refresh.default({ kind: "poll", seconds: 60 }),
  })
  .strict()
  .superRefine((m, ctx) => {
    const problem = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message })
    const ids = new Set<string>()
    m.sources.forEach((s, i) => {
      if (ids.has(s.id)) problem(["sources", i, "id"], `source "${s.id}" is declared twice`)
      ids.add(s.id)
    })
    m.sources.forEach((s, i) => {
      const fields = new Map<string, Field>()
      s.fields.forEach((f, j) => {
        if (fields.has(f.name)) problem(["sources", i, "fields", j], `${s.id}.${f.name} is declared twice`)
        fields.set(f.name, f)
        if (f.type === "enum" && !f.values) problem(["sources", i, "fields", j, "values"], `${s.id}.${f.name}: an enum needs its values`)
        if (f.role === "measure" && f.type !== "number" && f.type !== "integer") problem(["sources", i, "fields", j, "role"], `${s.id}.${f.name}: a measure must be a number`)
        if (f.role === "time" && f.type !== "date" && f.type !== "datetime") problem(["sources", i, "fields", j, "role"], `${s.id}.${f.name}: a time field must be a date or datetime`)
      })
      if (!fields.has(s.key)) problem(["sources", i, "key"], `${s.id}: key "${s.key}" is not a field`)
      if (s.time && fields.get(s.time)?.role !== "time") problem(["sources", i, "time"], `${s.id}: time "${s.time}" is not a time field`)
      s.relations.forEach((r, j) => {
        if (!fields.has(r.field)) problem(["sources", i, "relations", j, "field"], `${s.id}: relation field "${r.field}" is not a field`)
        if (!ids.has(r.to)) problem(["sources", i, "relations", j, "to"], `${s.id}: relation to unknown source "${r.to}"`)
      })
    })
    const actions = new Set<string>()
    m.actions.forEach((a, i) => {
      if (actions.has(a.id)) problem(["actions", i, "id"], `action "${a.id}" is declared twice`)
      actions.add(a.id)
      const source = a.source ? m.sources.find((s) => s.id === a.source) : undefined
      if (a.source && !source) problem(["actions", i, "source"], `${a.id}: unknown source "${a.source}"`)
      for (const p of placeholders(a.target)) if (!(p in a.params)) problem(["actions", i, "params"], `${a.id}: placeholder {${p}} has no param`)
      for (const [p, field] of Object.entries(a.params)) {
        if (!placeholders(a.target).includes(p)) problem(["actions", i, "params", p], `${a.id}: param "${p}" is not in the target`)
        if (!source) problem(["actions", i, "source"], `${a.id}: params need a source`)
        else if (!source.fields.some((f) => f.name === field)) problem(["actions", i, "params", p], `${a.id}: "${field}" is not a field of ${source.id}`)
      }
    })
  })
export type Manifest = z.infer<typeof Manifest>
export type ManifestInput = z.input<typeof Manifest>

/** First problem as one line the discovery agent can act on. */
export function issueLine(error: z.ZodError): string {
  const issue = error.issues[0]
  const where = issue.path.join(".")
  return `${where ? `${where}: ` : ""}${issue.message}`
}

export function parseManifest(value: unknown): { manifest: Manifest } | { error: string } {
  const r = Manifest.safeParse(value)
  return r.success ? { manifest: r.data } : { error: issueLine(r.error) }
}

export function sourceOf(m: Manifest, id: string): Source {
  const s = m.sources.find((x) => x.id === id)
  if (!s) throw new Error(`unknown source "${id}"`)
  return s
}

export function fieldOf(s: Source, name: string): Field | undefined {
  return s.fields.find((f) => f.name === name)
}

/** The host path an action opens, built by the host side from validated params (never by a widget). */
export function actionPath(m: Manifest, actionId: string, params: Record<string, string>): string | null {
  const a = m.actions.find((x) => x.id === actionId)
  if (!a) return null
  let missing = false
  const path = a.target.replace(PLACEHOLDER, (_, p: string) => {
    const v = params[p]
    if (typeof v !== "string" || !v) missing = true
    return encodeURIComponent(v ?? "")
  })
  return missing ? null : path
}

/**
 * The manifest's shape as JSON Schema, for apps that publish their own (skills/tomoe-ready). Checks the
 * shape only; cross-field rules (keys, roles, action params) are checked by parseManifest.
 */
export function manifestJsonSchema(): Record<string, unknown> {
  return {
    title: "Tomoe Source Manifest",
    description: "What a host app exposes to Tomoe: read-only sources, typed fields with roles and sensitivity, navigate-only actions.",
    ...z.toJSONSchema(Manifest, { io: "input", unrepresentable: "any" }),
  }
}
