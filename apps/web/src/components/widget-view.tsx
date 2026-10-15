/**
 * The catalog's renderer (packages/core/src/catalog.ts): a widget spec drawn with the theme's tokens.
 * Numbers come from the rows through the widget's queries, never from the spec. In privacy mode values
 * computed from sensitive fields are masked. A source that is not available says so; it is never zero.
 */
import * as React from "react"
import { ArrowUpRightIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, MessageCircleIcon, TriangleAlertIcon } from "lucide-react"
import {
  type Aggregate,
  type Context,
  type Manifest,
  type Query,
  type Row,
  type Series,
  selectRows,
  series as seriesOf,
  type Value,
  value as valueOf,
  type WidgetElement,
  type WidgetSpec,
  widgetQueries,
} from "@tomoe/core"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Markdown } from "@/components/markdown"
import { Button, cn, Gauge } from "@/components/ui"
import { useWorkspace } from "@/lib/workspace"

type Format = "number" | "money" | "percent" | "days"
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
const TICK = { fontSize: 10.5, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }
const HEIGHT = { sm: 120, md: 184, lg: 260 } as const
const GRID: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-1 @sm:grid-cols-2", 3: "grid-cols-1 @sm:grid-cols-2 @xl:grid-cols-3", 4: "grid-cols-2 @xl:grid-cols-4" }
const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6" } as const

type Env = { ctx: Context; privacy: boolean; fmt: Formatter; error: (s: string) => string | null }

class Formatter {
  readonly locale: string
  readonly currency: string
  constructor(m: Manifest) {
    this.locale = m.app.locale || "en"
    this.currency = m.app.currency ?? "EUR"
  }
  format(n: number, f: Format | undefined, compact = false): string {
    try {
      if (f === "money") return new Intl.NumberFormat(this.locale, { style: "currency", currency: this.currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 }).format(n)
      if (f === "percent") return new Intl.NumberFormat(this.locale, { style: "percent", maximumFractionDigits: 1 }).format(n > 1 ? n / 100 : n)
      if (f === "days") return `${new Intl.NumberFormat(this.locale).format(n)} ${Math.abs(n) === 1 ? "day" : "days"}`
      return new Intl.NumberFormat(this.locale, { notation: compact ? "compact" : "standard", maximumFractionDigits: 2 }).format(n)
    } catch {
      return String(n)
    }
  }
  key(k: string): string {
    if (/^\d{4}-\d{2}-01$/.test(k)) return new Date(`${k}T00:00:00`).toLocaleDateString(this.locale, { month: "short", year: "2-digit" })
    if (/^\d{4}-01-01$/.test(k)) return k.slice(0, 4)
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return new Date(`${k}T00:00:00`).toLocaleDateString(this.locale, { day: "numeric", month: "short" })
    return k
  }
  cell(v: unknown): string {
    if (v === null || v === undefined || v === "") return "—"
    if (typeof v === "number") return this.format(v, "number")
    if (typeof v === "boolean") return v ? "Yes" : "No"
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString(this.locale, { day: "numeric", month: "short", year: "numeric" })
    return String(v)
  }
}

/** Whether a value or series is computed from a sensitive field (masked in privacy mode). */
function sensitive(m: Manifest, q: { from: string; measure?: { op: string; field?: string } }): boolean {
  const field = q.measure && "field" in q.measure ? q.measure.field : undefined
  return !!field && !!m.sources.find((s) => s.id === q.from)?.fields.find((f) => f.name === field)?.sensitive
}
const isSensitiveField = (m: Manifest, source: string, field: string) => !!m.sources.find((s) => s.id === source)?.fields.find((f) => f.name === field)?.sensitive
const unitFormat = (m: Manifest, q: { from: string; measure?: { op: string; field?: string } }): Format | undefined => {
  const field = q.measure && "field" in q.measure ? q.measure.field : undefined
  const unit = field ? m.sources.find((s) => s.id === q.from)?.fields.find((f) => f.name === field)?.unit : undefined
  return unit?.startsWith("currency") ? "money" : unit === "percent" ? "percent" : undefined
}

export function WidgetView({ spec, className }: { spec: WidgetSpec; className?: string }) {
  const { context, need, pending, privacy, tomoe, rowsError } = useWorkspace()
  const sources = React.useMemo(() => [...new Set(widgetQueries({ id: "x", title: "x", size: "medium", kind: "spec", spec }).map((q) => q.from))], [spec])
  React.useEffect(() => need(sources), [need, sources])
  if (!context || !tomoe || pending(sources))
    return (
      <div className={cn("flex flex-col gap-3", className)} aria-busy>
        <div className="shimmer h-3 w-24 rounded-full" />
        <div className="shimmer h-24 rounded-lg" />
      </div>
    )
  const env: Env = { ctx: context, privacy, fmt: new Formatter(tomoe.manifest), error: rowsError }
  return (
    <div className={cn("@container flex min-w-0 animate-fade flex-col gap-4", className)}>
      <Boundary>
        <Element spec={spec} id={spec.root} env={env} />
      </Boundary>
    </div>
  )
}

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p className="text-sm text-muted-foreground">This widget cannot be shown.</p> : this.props.children
  }
}

function Element({ spec, id, env }: { spec: WidgetSpec; id: string; env: Env }) {
  const el = spec.elements[id]
  if (!el) return null
  return (
    <Component el={el} env={env}>
      {el.children.map((c) => (
        <Element key={c} spec={spec} id={c} env={env} />
      ))}
    </Component>
  )
}

function Component({ el, env, children }: { el: WidgetElement; env: Env; children: React.ReactNode }) {
  const p = el.props as Record<string, never>
  switch (el.type) {
    case "Grid":
      return <div className={cn("grid gap-4", GRID[(p.columns as number | undefined) ?? 2])}>{children}</div>
    case "Stack":
      return <div className={cn("flex min-w-0", p.direction === "row" ? "flex-row flex-wrap items-center" : "flex-col", GAP[(p.gap as keyof typeof GAP | undefined) ?? "md"])}>{children}</div>
    case "Section":
      return (
        <section className="flex min-w-0 flex-col gap-3">
          <div>
            <h4 className="label-caps">{p.title}</h4>
            {p.description && <p className="mt-1.5 text-xs text-muted-foreground">{p.description}</p>}
          </div>
          {children}
        </section>
      )
    case "Heading":
      return <h4 className="font-display text-lg font-normal tracking-tight">{p.text}</h4>
    case "Text":
      return <Markdown text={p.text} className={cn("text-sm", p.muted && "text-muted-foreground")} />
    case "Callout":
      return <Callout tone={p.tone} title={p.title} text={p.text} />
    case "Separator":
      return <hr className="border-border" />
    case "Metric":
      return <Metric label={p.label} value={p.value} format={p.format} hint={p.hint} env={env} />
    case "Progress":
      return <ProgressBar label={p.label} value={p.value} max={p.max} format={p.format} env={env} />
    case "Chart":
      return <Chart kind={p.kind} series={p.series} height={p.height} cumulative={p.cumulative} env={env} />
    case "Table":
      return <Table query={p.query} columns={p.columns} limit={p.limit} empty={p.empty} env={env} />
    case "List":
      return <List query={p.query} title={p.title} subtitle={p.subtitle} badge={p.badge} action={p.action} limit={p.limit} empty={p.empty} env={env} />
    case "Countdown":
      return <Countdown query={p.query} label={p.label} env={env} />
    case "Button":
      return <ActionButton label={p.label} action={p.action} />
    default:
      return null
  }
}

function Unavailable({ source, env }: { source: string; env: Env }) {
  const label = env.ctx.manifest.sources.find((s) => s.id === source)?.label ?? source
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed border-foreground/20 px-3 py-2 text-xs text-muted-foreground">
      <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
      <span>
        {label} is not available{env.error(source) ? `: ${env.error(source)}` : "."}
      </span>
    </p>
  )
}

function Masked({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={cn(on && "masked")}>{children}</span>
}

function Callout({ tone, title, text }: { tone: "info" | "success" | "warning" | "danger"; title?: string; text: string }) {
  const t = {
    info: { box: "border-foreground/15 bg-muted/60", icon: InfoIcon, ink: "text-foreground" },
    success: { box: "border-positive/25 bg-positive/[0.06]", icon: CircleCheckIcon, ink: "text-positive" },
    warning: { box: "border-warning/30 bg-warning/[0.07]", icon: TriangleAlertIcon, ink: "text-warning" },
    danger: { box: "border-negative/25 bg-negative/[0.06]", icon: CircleAlertIcon, ink: "text-negative" },
  }[tone]
  const Icon = t.icon
  return (
    <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5", t.box)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.ink)} />
      <div className="min-w-0 text-sm">
        {title && <p className="font-medium">{title}</p>}
        <Markdown text={text} className="text-sm" />
      </div>
    </div>
  )
}

function Metric({ label, value, format, hint, env }: { label: string; value: Value; format?: Format; hint?: string; env: Env }) {
  const q = typeof value === "number" ? null : (value as Aggregate)
  const n = valueOf(value, env.ctx)
  const fmt = format ?? (q ? unitFormat(env.ctx.manifest, q) : undefined)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="label-caps">{label}</span>
      {q && env.ctx.rows(q.from) === null ? (
        <Unavailable source={q.from} env={env} />
      ) : (
        <span className="font-display text-[2rem] leading-none font-normal tracking-[-0.03em]">
          <Masked on={env.privacy && !!q && sensitive(env.ctx.manifest, q)}>{n === null ? "—" : env.fmt.format(n, fmt)}</Masked>
        </span>
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

function ProgressBar({ label, value, max, format, env }: { label: string; value: Value; max: Value; format?: Format; env: Env }) {
  const v = valueOf(value, env.ctx) ?? 0
  const m = valueOf(max, env.ctx) ?? 0
  const pct = m > 0 ? Math.min(100, Math.max(0, (v / m) * 100)) : 0
  const hide = env.privacy && [value, max].some((x) => typeof x !== "number" && sensitive(env.ctx.manifest, x as Aggregate))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps">{label}</span>
        <Masked on={hide}>
          <span className="font-mono text-xs tabular-nums">
            {env.fmt.format(v, format)} <span className="text-muted-foreground">/ {env.fmt.format(m, format)}</span>
          </span>
        </Masked>
      </div>
      <Gauge value={pct} />
      <span className="font-mono text-[10.5px] tracking-[0.12em] text-muted-foreground tabular-nums">{Math.round(pct)}%</span>
    </div>
  )
}

function Chart({ kind, series, height, cumulative, env }: { kind: "bar" | "line" | "area" | "donut"; series: Series; height?: keyof typeof HEIGHT; cumulative?: boolean; env: Env }) {
  const points = seriesOf(series, env.ctx, cumulative)
  if (!points) return <Unavailable source={series.from} env={env} />
  if (!points.length) return <p className="text-sm text-muted-foreground">Nothing to chart yet.</p>
  const h = HEIGHT[height ?? "md"]
  const fmt = unitFormat(env.ctx.manifest, series)
  const hide = env.privacy && sensitive(env.ctx.manifest, series)
  const data = points.map((p) => ({ key: env.fmt.key(p.key), value: p.value }))
  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--muted)", opacity: 0.6, stroke: "var(--foreground)", strokeOpacity: 0.25, strokeDasharray: "2 3" }}
      contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 999, fontSize: 11.5, padding: "4px 12px", boxShadow: "var(--shadow)", fontFamily: "var(--font-mono)" }}
      labelStyle={{ color: "var(--muted-foreground)", display: "inline", marginRight: 8 }}
      itemStyle={{ color: "var(--foreground)", display: "inline", padding: 0 }}
      formatter={(v) => [hide ? "•••" : env.fmt.format(Number(v), fmt), ""]}
      separator=""
    />
  )
  const yAxis = <YAxis tick={TICK} axisLine={false} tickLine={false} width={hide ? 8 : 44} tickFormatter={(v: number) => (hide ? "" : env.fmt.format(v, fmt, true))} />
  const xAxis = <XAxis dataKey="key" tick={TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="1 4" />
  if (kind === "donut") {
    const total = data.reduce((a, b) => a + b.value, 0)
    return (
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center">
        <div style={{ height: h, minWidth: h }} className="relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              {tooltip}
              <Pie data={data.slice(0, 8)} dataKey="value" nameKey="key" innerRadius="66%" outerRadius="96%" paddingAngle={2} cornerRadius={3} stroke="var(--card)" strokeWidth={1.5} animationDuration={900} animationEasing="ease-out">
                {data.slice(0, 8).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          {data.slice(0, 8).map((d, i) => (
            <li key={d.key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full border border-foreground/30" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate">{d.key}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div style={{ height: h }} className="-ml-1 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            <Bar dataKey="value" fill="var(--chart-1)" radius={[5, 5, 1, 1]} maxBarSize={24} animationDuration={800} animationEasing="ease-out" />
          </BarChart>
        ) : kind === "line" ? (
          <LineChart data={data} margin={{ top: 6, right: 18, bottom: 0, left: 0 }}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            <Line dataKey="value" stroke="var(--chart-1)" strokeWidth={1.75} dot={false} activeDot={{ r: 4.5, fill: "var(--card)", stroke: "var(--foreground)", strokeWidth: 1.5 }} animationDuration={1100} animationEasing="ease-out" />
          </LineChart>
        ) : (
          <AreaChart data={data} margin={{ top: 6, right: 18, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="tomoe-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            <Area dataKey="value" stroke="var(--chart-1)" strokeWidth={1.75} fill="url(#tomoe-area)" activeDot={{ r: 4.5, fill: "var(--card)", stroke: "var(--foreground)", strokeWidth: 1.5 }} animationDuration={1100} animationEasing="ease-out" />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function Table({ query, columns, limit, empty, env }: { query: Query; columns: string[]; limit?: number; empty?: string; env: Env }) {
  const rows = selectRows({ ...query, limit: Math.min(limit ?? 10, query.limit ?? 100) }, env.ctx)
  if (!rows) return <Unavailable source={query.from} env={env} />
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty ?? "No rows."}</p>
  const source = env.ctx.manifest.sources.find((s) => s.id === query.from)
  const label = (c: string) => source?.fields.find((f) => f.name === c)?.label ?? c
  const numeric = (c: string) => ["number", "integer"].includes(source?.fields.find((f) => f.name === c)?.type ?? "")
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            {columns.map((c) => (
              <th key={c} className={cn("label-caps border-b border-foreground/25 px-1.5 pb-2 text-[9.5px]!", numeric(c) && "text-right")}>
                {label(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
              {columns.map((c) => (
                <td key={c} className={cn("px-1.5 py-2", numeric(c) && "text-right font-mono text-[12.5px] tabular-nums")}>
                  <Masked on={env.privacy && isSensitiveField(env.ctx.manifest, query.from, c)}>{cellText(env, query.from, c, r)}</Masked>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function cellText(env: Env, source: string, field: string, r: Row) {
  const unit = env.ctx.manifest.sources.find((s) => s.id === source)?.fields.find((f) => f.name === field)?.unit
  const v = r[field]
  if (typeof v === "number" && unit?.startsWith("currency")) return env.fmt.format(v, "money")
  return env.fmt.cell(v)
}

function List(p: { query: Query; title: string; subtitle?: string; badge?: string; action?: string; limit?: number; empty?: string; env: Env }) {
  const { open } = useWorkspace()
  const { env, query } = p
  const rows = selectRows({ ...query, limit: Math.min(p.limit ?? 6, query.limit ?? 50) }, env.ctx)
  if (!rows) return <Unavailable source={query.from} env={env} />
  if (!rows.length) return <p className="text-sm text-muted-foreground">{p.empty ?? "Nothing here."}</p>
  const action = p.action ? env.ctx.manifest.actions.find((a) => a.id === p.action) : undefined
  const mask = (f?: string) => !!f && env.privacy && isSensitiveField(env.ctx.manifest, query.from, f)
  return (
    <ul className="-mx-2 flex flex-col">
      {rows.map((r, i) => {
        const content = (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <Masked on={mask(p.title)}>{cellText(env, query.from, p.title, r)}</Masked>
              </p>
              {p.subtitle && (
                <p className="truncate text-xs text-muted-foreground">
                  <Masked on={mask(p.subtitle)}>{cellText(env, query.from, p.subtitle, r)}</Masked>
                </p>
              )}
            </div>
            {p.badge && (
              <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Masked on={mask(p.badge)}>{cellText(env, query.from, p.badge, r)}</Masked>
              </span>
            )}
            {action && <ArrowUpRightIcon className="size-3.5 shrink-0 -translate-x-1 translate-y-1 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-0 group-hover:opacity-100" />}
          </>
        )
        return (
          <li key={i}>
            {action ? (
              <button
                type="button"
                className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left transition-[background-color,padding] duration-200 hover:bg-muted hover:pl-3 active:scale-[0.99]"
                onClick={() => open(action.id, Object.fromEntries(Object.entries(action.params).map(([k, f]) => [k, String(r[f] ?? "")])))}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-2 py-1.5">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Countdown({ query, label, env }: { query: Query; label?: string; env: Env }) {
  const source = env.ctx.manifest.sources.find((s) => s.id === query.from)
  const time = query.window?.field ?? source?.time
  const rows = selectRows({ ...query, where: [...(query.where ?? []), ...(time ? [{ field: time, op: "gte" as const, value: env.ctx.today }] : [])], sort: time ? { field: time, dir: "asc" } : undefined, limit: 1 }, env.ctx)
  if (!rows) return <Unavailable source={query.from} env={env} />
  const first = rows[0]?.[time ?? ""]
  const days = typeof first === "string" ? Math.round((Date.parse(first.slice(0, 10)) - Date.parse(env.ctx.today)) / 86_400_000) : null
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-4xl font-normal tracking-[-0.03em]">{days ?? "—"}</span>
      <span className="text-sm text-muted-foreground">{days === null ? "nothing ahead" : `${days === 1 ? "day" : "days"}${label ? ` · ${label}` : ""}`}</span>
    </div>
  )
}

function ActionButton({ label, action }: { label: string; action: { type: "open"; action: string; params?: Record<string, string> } | { type: "ask"; question: string } }) {
  const { open, askChat } = useWorkspace()
  return (
    <Button variant="outline" size="sm" className="self-start" onClick={() => (action.type === "open" ? open(action.action, action.params) : askChat({ text: action.question }))}>
      {action.type === "ask" ? <MessageCircleIcon /> : <ArrowUpRightIcon />}
      {label}
    </Button>
  )
}
