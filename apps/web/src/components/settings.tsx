/**
 * Settings for connected apps: every app, its connection and its sources, with three verbs. Test reads
 * each source's first page through the server (counts, latency, errors; never values). Recheck runs recon,
 * then discovery, and shows the draft as a diff before the usual review. Reconfigure edits the connection
 * (header values are write-only: blank keeps the stored one), the sources and their privacy (the review),
 * the data files, the draft, or deletes the app.
 */
import * as React from "react"
import { ArrowLeftIcon, BoxIcon, DatabaseIcon, FileUpIcon, FolderGit2Icon, GlobeIcon, KeyRoundIcon, ListTreeIcon, PlayIcon, PlusIcon, RadarIcon, Trash2Icon, XIcon } from "lucide-react"
import type { Manifest } from "@tomoe/core"
import { toast } from "sonner"

import { ReconList } from "@/components/connect"
import { DiffSummary } from "@/components/manifest-diff"
import { Badge, Button, cn, DoneCheck, Field, Gauge, inputClass, Kbd, Label, TomoeMark } from "@/components/ui"
import { api, type AppRecord, type Check, type Recon } from "@/lib/api"
import { useMascotWork } from "@/lib/mascot"
import { useWorkspace } from "@/lib/workspace"

const KIND_ICON = { playground: BoxIcon, example: DatabaseIcon, connected: FolderGit2Icon }
const KIND_LABEL = { playground: "Playground", example: "Example", connected: "Connected" }

const ago = (iso: string | null | undefined) => {
  if (!iso) return "never"
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  const a = Math.abs(s)
  if (a < 45) return "just now"
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute")
  if (a < 86_400) return rtf.format(Math.round(s / 3600), "hour")
  if (a < 86_400 * 30) return rtf.format(Math.round(s / 86_400), "day")
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export function SettingsView({ onClose }: { onClose: () => void }) {
  const { apps, app, selectApp, setDialog, detail } = useWorkspace()
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-8">
        <header className="flex flex-wrap items-end gap-3 border-b pb-5">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Label>Settings</Label>
            <h2 className="font-display text-[1.7rem] leading-none font-normal tracking-[-0.02em]">Apps and sources</h2>
          </div>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Kbd>,</Kbd> open or close
          </span>
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "connect" })}>
            <PlusIcon />
            Connect an app
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="[&_svg]:transition-transform hover:[&_svg]:-translate-x-0.5">
            <ArrowLeftIcon />
            Back
          </Button>
        </header>
        <div className="grid gap-8 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Apps" className="flex flex-col gap-2">
            <span className="label-caps pb-1">Apps</span>
            <ul className="stagger flex flex-col gap-1">
              {apps.map((a) => (
                <AppRow key={a.id} app={a} active={a.id === app?.id} draft={a.id === app?.id && !!detail?.draft} onClick={() => selectApp(a.id)} />
              ))}
            </ul>
          </nav>
          {app && detail && detail.app.id === app.id ? <AppSettings key={app.id} /> : <div className="shimmer h-80 rounded-2xl" />}
        </div>
      </div>
    </div>
  )
}

function AppRow({ app, active, draft, onClick }: { app: AppRecord; active: boolean; draft: boolean; onClick: () => void }) {
  const Icon = KIND_ICON[app.kind]
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/app relative flex w-full cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,padding] duration-200 active:scale-[0.98]",
          active ? "border-foreground/70 bg-card shadow-soft" : "border-transparent hover:border-foreground/15 hover:bg-card/60 hover:pl-4"
        )}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{app.name}</span>
          <span className="truncate font-mono text-[10.5px] text-muted-foreground">{app.connection.website ?? app.connection.url ?? KIND_LABEL[app.kind].toLowerCase()}</span>
        </span>
        {draft && <span className="size-1.5 animate-pulse rounded-full bg-foreground" title="A draft waits for review" />}
        {active && <span className="absolute top-1/2 -left-px h-5 w-[3px] -translate-y-1/2 rounded-full bg-foreground" aria-hidden />}
      </button>
    </li>
  )
}

function AppSettings() {
  const { app, detail } = useWorkspace()
  if (!app || !detail) return null
  const Icon = KIND_ICON[app.kind]
  return (
    <div className="stagger flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full border border-foreground/25">
          <Icon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-display text-xl font-normal tracking-tight">{app.name}</span>
          <span className="text-xs text-muted-foreground">
            {KIND_LABEL[app.kind]} · added {ago(app.created)} · manifest {detail.accepted ? `accepted ${ago(detail.accepted)}` : "not accepted yet"}
          </span>
        </div>
      </div>
      {detail.draft && <DraftPanel />}
      <SourcesPanel />
      {app.kind === "connected" && <RecheckPanel />}
      {app.kind === "connected" ? <ConnectionPanel /> : <NoConnection />}
      <DataPanel />
      {app.kind !== "playground" && <DangerPanel />}
    </div>
  )
}

/** A titled block of the sheet. */
function Panel({ label, count, action, children, className }: { label: string; count?: number; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-5 transition-[border-color] duration-300 hover:border-foreground/20", className)}>
      <header className="flex min-h-8 flex-wrap items-center gap-3">
        <span className="label-caps flex flex-1 items-baseline gap-2">
          {label}
          {count !== undefined && <span className="font-mono text-[11px] tracking-normal text-foreground">{count}</span>}
        </span>
        {action}
      </header>
      {children}
    </section>
  )
}

// ---------- sources: status and Test ----------

type Run = { state: "running" } | { state: "done"; fresh: boolean }

function SourcesPanel() {
  const { app, detail, tomoe, setDialog, refresh } = useWorkspace()
  const sources = tomoe?.manifest.sources ?? []
  const [checks, setChecks] = React.useState<Record<string, Check>>(detail?.checks ?? {})
  const [runs, setRuns] = React.useState<Record<string, Run>>({})
  const running = Object.values(runs).some((r) => r.state === "running")
  const failed = sources.some((s) => checks[s.id] && !checks[s.id].ok)
  useMascotWork("settings-test", running, failed)

  React.useEffect(() => setChecks(detail?.checks ?? {}), [detail?.checks])

  const test = async (source?: string) => {
    if (!app) return
    const ids = source ? [source] : sources.map((s) => s.id)
    setRuns((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, { state: "running" } as Run])) }))
    try {
      const r = await api.test(app.id, source)
      setChecks(r.checks)
      const bad = r.results.filter((x) => !x.ok)
      if (bad.length) toast.error(bad.length === 1 ? `${bad[0].label}: ${bad[0].error}` : `${bad.length} sources failed the test`)
      else toast.success(source ? `${r.results[0]?.label} answers` : `All ${r.results.length} sources answer`)
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRuns((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, { state: "done", fresh: true } as Run])) }))
    }
  }

  return (
    <Panel
      label="Sources"
      count={sources.length}
      action={
        <>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "review" })} disabled={!sources.length}>
            <ListTreeIcon />
            Fields and privacy
          </Button>
          <Button size="sm" variant="primary" onClick={() => void test()} disabled={!sources.length || running}>
            {running ? <TomoeMark working className="size-4" /> : <PlayIcon />}
            {running ? "Testing…" : "Test all"}
          </Button>
        </>
      }
    >
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources yet. Connect the app’s API, or add a data file below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70">
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} check={checks[s.id]} run={runs[s.id]} onTest={() => void test(s.id)} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SourceRow({ source, check, run, onTest }: { source: Manifest["sources"][number]; check?: Check; run?: Run; onTest: () => void }) {
  const busy = run?.state === "running"
  const fresh = run?.state === "done" && run.fresh
  const sensitive = source.fields.filter((f) => f.sensitive).length
  const status = busy ? "running" : !check ? "never" : check.ok ? (check.missing.length ? "warn" : "ok") : "error"
  return (
    <li className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <StatusDot status={status} fresh={fresh} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{source.label}</span>
            <code className="font-mono text-[11px] text-muted-foreground">{source.id}</code>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge tone="outline" className="font-mono tracking-normal">
              {source.origin.kind === "rest" ? (
                <>
                  <GlobeIcon className="size-3" />
                  GET {source.origin.path}
                </>
              ) : source.origin.kind === "memory" ? (
                <>
                  <DatabaseIcon className="size-3" />
                  stored rows
                </>
              ) : (
                source.origin.kind
              )}
            </Badge>
            <span>
              {source.fields.length} fields{sensitive ? ` · ${sensitive} hidden in privacy mode` : ""}
            </span>
          </span>
        </div>
        <div className="flex min-w-36 flex-col items-end gap-1 text-right">
          {busy ? (
            <>
              <span className="label-caps text-[9.5px]!">Reading a sample</span>
              <Gauge className="h-1.5! w-28" />
            </>
          ) : check ? (
            <>
              <span key={check.at} className="flex animate-fade items-baseline gap-3 font-mono text-xs tabular-nums">
                {check.ok ? (
                  <>
                    <span>
                      {check.rows} <span className="text-muted-foreground">rows</span>
                    </span>
                    <span>
                      {check.ms} <span className="text-muted-foreground">ms</span>
                    </span>
                  </>
                ) : (
                  <span className="text-negative">failed</span>
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">checked {ago(check.at)}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">not tested yet</span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={onTest} disabled={busy} aria-label={`Test ${source.label}`}>
          Test
        </Button>
      </div>
      {!busy && check && !check.ok && check.error && (
        <p key={check.at} role="alert" className="ml-7 flex animate-shake items-start gap-2 rounded-lg border border-negative/25 bg-negative/[0.06] px-3 py-2 text-[13px] text-negative">
          <span className="error-underline pb-0.5 break-words">{check.error}</span>
        </p>
      )}
      {!busy && check?.ok && check.missing.length > 0 && (
        <p className="ml-7 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2 text-[13px]">
          No row in the sample has <span className="font-mono text-xs">{check.missing.join(", ")}</span>. The app may have changed: recheck it.
        </p>
      )}
    </li>
  )
}

function StatusDot({ status, fresh }: { status: "running" | "never" | "ok" | "warn" | "error"; fresh: boolean }) {
  if (status === "ok" && fresh) return <DoneCheck className="size-4" />
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center" aria-label={status}>
      {status === "running" && <span className="absolute inset-0 animate-[spin_1.1s_linear_infinite] rounded-full border border-dashed border-foreground" />}
      <span
        className={cn(
          "size-2 rounded-full",
          status === "ok" && "bg-foreground",
          status === "warn" && "bg-warning",
          status === "error" && "bg-negative",
          status === "never" && "border border-foreground/40",
          status === "running" && "bg-foreground/60"
        )}
      />
      {status === "error" && <span className="absolute inset-0 animate-ping rounded-full bg-negative/30 [animation-iteration-count:2]" />}
    </span>
  )
}

// ---------- draft and recheck ----------

function DraftPanel() {
  const { app, detail, setDialog, reloadDetail } = useWorkspace()
  const [busy, setBusy] = React.useState(false)
  if (!app || !detail?.draft) return null
  return (
    <Panel
      label={`Draft from ${ago(detail.draft.created)}`}
      className="border-foreground/50"
      action={
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.discardDraft(app.id)
                await reloadDetail()
                toast("Draft discarded")
              } catch (e) {
                toast.error((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <XIcon />
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "review" })}>
            Review and accept
          </Button>
        </>
      }
    >
      <DiffSummary before={detail.manifest} after={detail.draft.manifest as Manifest} />
      {detail.draft.problems.length > 0 && <p className="text-xs text-muted-foreground">The probe found {detail.draft.problems.length} things to check: see the review.</p>}
    </Panel>
  )
}

function RecheckPanel() {
  const { app, setDialog } = useWorkspace()
  const [report, setReport] = React.useState<Recon | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  useMascotWork("settings-recheck", busy, !!error)
  const target = app?.connection.website ?? app?.connection.url ?? app?.connection.openapi

  const recheck = async () => {
    if (!target) return
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      setReport(await api.recon(target))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      label="Recheck"
      action={
        <>
          <Button size="sm" variant="outline" onClick={() => void recheck()} disabled={!target || busy}>
            {busy ? <TomoeMark working className="size-4" /> : <RadarIcon />}
            {busy ? "Looking…" : "Look again"}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "discover" })}>
            Run discovery
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-muted-foreground">
        {target ? (
          <>
            Looks at <span className="font-mono text-xs text-foreground">{target}</span> for llms.txt, OpenAPI, MCP and tomoe.json. Discovery drafts a new manifest; you see what changed before anything is used.
          </>
        ) : (
          "Add a website or an API URL below to recheck this app."
        )}
      </p>
      {busy && <Gauge className="h-1.5! w-48" />}
      {error && (
        <p role="alert" className="flex animate-shake items-start gap-2 rounded-lg border border-negative/25 bg-negative/[0.06] px-3 py-2 text-[13px] text-negative">
          <span className="error-underline pb-0.5">{error}</span>
        </p>
      )}
      {report && (
        <div className="flex animate-rise flex-col gap-2">
          <span className="flex items-center gap-2 text-[13px]">
            <DoneCheck className="size-4" />
            {report.findings.filter((f) => f.ok).length} of {report.findings.length} places answered
            {report.manifest && <Badge tone="primary">Tomoe-ready</Badge>}
          </span>
          <ReconList findings={report.findings} />
        </div>
      )}
    </Panel>
  )
}

// ---------- reconfigure ----------

type HeaderRow = { key: string; name: string; value: string; stored: boolean }

function ConnectionPanel() {
  const { app, reloadApps, reloadDetail } = useWorkspace()
  const initial = React.useMemo(
    () => ({
      name: app?.name ?? "",
      website: app?.connection.website ?? "",
      url: app?.connection.url ?? "",
      openapi: app?.connection.openapi ?? "",
      repo: app?.connection.repo ?? "",
      headers: Object.keys(app?.connection.headers ?? {}).map((name, i) => ({ key: `s${i}`, name, value: "", stored: true })) as HeaderRow[],
    }),
    [app]
  )
  const [form, setForm] = React.useState(initial)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(0)
  const [problem, setProblem] = React.useState<string | null>(null)
  React.useEffect(() => setForm(initial), [initial])
  if (!app) return null

  const dirty =
    form.name !== initial.name ||
    (["website", "url", "openapi", "repo"] as const).some((k) => form[k] !== initial[k]) ||
    form.headers.some((h) => !h.stored || h.value) ||
    form.headers.filter((h) => h.stored).length !== initial.headers.length
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }))
    setProblem(null)
  }
  const setHeader = (key: string, patch: Partial<HeaderRow>) => set({ headers: form.headers.map((h) => (h.key === key ? { ...h, ...patch } : h)) })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setProblem(null)
    const url = (v: string) => v.trim() || null
    try {
      await api.updateApp(app.id, {
        name: form.name.trim() || app.name,
        connection: {
          website: url(form.website),
          url: url(form.url),
          openapi: url(form.openapi),
          repo: url(form.repo),
          // A stored header with a blank value keeps its value on the server; a new one needs a value.
          headers: Object.fromEntries(form.headers.filter((h) => h.name.trim() && (h.stored || h.value)).map((h) => [h.name.trim(), h.value])),
        },
      })
      await reloadApps()
      await reloadDetail()
      setSaved((n) => n + 1)
      toast.success("Connection saved. Test the sources to check it.")
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const mono = cn(inputClass, "font-mono text-[13px]")
  return (
    <Panel label="Connection">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website or web app" hint="Recon and actions start here.">
            <input className={mono} value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://app.example.com" spellCheck={false} />
          </Field>
          <Field label="API base URL" hint="GET requests only, on this origin only.">
            <input className={mono} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com" spellCheck={false} />
          </Field>
          <Field label="OpenAPI document">
            <input className={mono} value={form.openapi} onChange={(e) => set({ openapi: e.target.value })} placeholder="…/openapi.json" spellCheck={false} />
          </Field>
          <Field label="Repository folder" hint="A local checkout the agents may read.">
            <input className={mono} value={form.repo} onChange={(e) => set({ repo: e.target.value })} placeholder="~/code/my-app" spellCheck={false} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="label-caps">Auth headers</span>
          <p className="text-xs text-muted-foreground">Sent to the API origin only. Stored values never come back to this page: type a new value to replace one, leave it blank to keep it. Moving the API to another address clears them. A bare token in Authorization is sent as “Bearer” plus the token.</p>
          {form.headers.map((h) => (
            <div key={h.key} className="grid animate-pop grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2">
              <input className={mono} value={h.name} disabled={h.stored} onChange={(e) => setHeader(h.key, { name: e.target.value })} placeholder="Authorization" aria-label="Header name" spellCheck={false} />
              <div className="relative">
                <input
                  className={cn(mono, h.stored && !h.value && "pr-20")}
                  type="password"
                  value={h.value}
                  onChange={(e) => setHeader(h.key, { value: e.target.value })}
                  placeholder={h.stored ? "Type a new value to replace it" : "Bearer …"}
                  aria-label={`Value of ${h.name || "the header"}`}
                  autoComplete="off"
                />
                {h.stored && !h.value && (
                  <span className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1 rounded-full border border-foreground/20 px-2 py-0.5 text-[10.5px] text-muted-foreground">
                    <KeyRoundIcon className="size-3" />
                    set
                  </span>
                )}
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${h.name || "header"}`} onClick={() => set({ headers: form.headers.filter((x) => x.key !== h.key) })}>
                <XIcon />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => set({ headers: [...form.headers, { key: `n${Date.now()}`, name: form.headers.length ? "" : "Authorization", value: "", stored: false }] })}>
            <PlusIcon />
            Add a header
          </Button>
        </div>
        {problem && (
          <p role="alert" className="flex animate-shake items-start gap-2 rounded-lg border border-negative/25 bg-negative/[0.06] px-3 py-2 text-[13px] text-negative">
            <span className="error-underline pb-0.5 break-words">{problem}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!dirty || saving}>
            {saving ? <TomoeMark working className="size-4" /> : saved > 0 && !dirty ? <DoneCheck key={saved} className="size-4" /> : null}
            {saving ? "Saving…" : saved > 0 && !dirty ? "Saved" : "Save changes"}
          </Button>
          {dirty && !saving && (
            <Button variant="ghost" onClick={() => setForm(initial)}>
              Undo edits
            </Button>
          )}
        </div>
      </form>
    </Panel>
  )
}

function NoConnection() {
  const { app } = useWorkspace()
  return (
    <Panel label="Connection">
      <p className="text-[13px] text-muted-foreground">
        {app?.kind === "example" ? "Made-up rows kept by Tomoe: there is no website or API to configure." : "The Playground has no connection: data files you add become its sources. To work on a real app, connect it."}
      </p>
    </Panel>
  )
}

function DataPanel() {
  const { app, reloadDetail, setDialog } = useWorkspace()
  const picker = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  if (!app) return null
  const add = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const [saved] = await api.upload(app.id, [file])
      await api.dataFile(app.id, saved.path)
      await reloadDetail()
      setDialog({ kind: "review" })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel
      label="Data files"
      action={
        <Button size="sm" variant="outline" onClick={() => picker.current?.click()} disabled={busy}>
          {busy ? <TomoeMark working className="size-4" /> : <FileUpIcon />}
          {busy ? "Reading…" : "Add or replace a file"}
        </Button>
      }
    >
      <p className="text-[13px] text-muted-foreground">A CSV or JSON file becomes a source of {app.name}, in a draft you review. To replace a file, add the new one and untick the old source in the review.</p>
      <input ref={picker} type="file" accept=".csv,.tsv,.json" hidden onChange={(e) => (void add(e.target.files?.[0]), (e.target.value = ""))} />
    </Panel>
  )
}

function DangerPanel() {
  const { app, reloadApps, selectApp } = useWorkspace()
  const [armed, setArmed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(t)
  }, [armed])
  if (!app) return null
  return (
    <Panel label="Remove" className="border-negative/25 hover:border-negative/45">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">Deletes {app.name} from Tomoe: its manifest, board, chats and files here. The app itself is not touched.</p>
        {armed ? (
          <div className="flex animate-pop items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="bg-negative! text-background! animate-[shake_420ms_ease-in-out_1]"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.deleteApp(app.id)
                  await reloadApps("playground")
                  selectApp("playground")
                  toast(`Deleted ${app.name}`)
                } catch (e) {
                  toast.error((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Trash2Icon />
              Delete {app.name}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setArmed(true)}>
            <Trash2Icon />
            Delete app
          </Button>
        )}
      </div>
    </Panel>
  )
}
