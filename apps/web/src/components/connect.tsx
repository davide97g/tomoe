/**
 * Connecting an app from what the user has: a URL (website, web app or API), screenshots, a repo folder,
 * an OpenAPI document, or a data file. "Test" runs the server's recon on the URL (llms.txt, OpenAPI,
 * MCP, GraphQL, /.well-known/tomoe.json) and fills in what it finds; the discovery agent then reads the
 * rest. A Tomoe-ready app (the tomoe-ready skill) publishes its manifest and needs no agent. Nothing is
 * used until the user accepts the manifest.
 */
import * as React from "react"
import {
  BoxIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CopyIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  GlobeIcon,
  ImagePlusIcon,
  RadarIcon,
  ShieldIcon,
  SparklesIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { FIELD_ROLES, type Manifest } from "@tomoe/core"
import { toast } from "sonner"

import { Markdown } from "@/components/markdown"
import { Badge, Button, cn, Dialog, Field, inputClass, TomoeMark } from "@/components/ui"
import { api, discoverPath, type Finding, type Recon, stream } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

export function Dialogs() {
  const { dialog, setDialog } = useWorkspace()
  const close = () => setDialog(null)
  return (
    <>
      <Dialog open={dialog?.kind === "connect"} onClose={close} title="Connect an app" description="Give Tomoe a URL and anything else you have. It reads, never writes; credentials stay on this machine." wide>
        <ConnectForm initialUrl={dialog?.kind === "connect" ? dialog.url : undefined} />
      </Dialog>
      <Dialog open={dialog?.kind === "discover"} onClose={close} title="Reading the app" description="Recon first, then the discovery agent: website, docs, API description, screenshots and code." wide>
        <Discovery />
      </Dialog>
      <Dialog open={dialog?.kind === "review"} onClose={close} title="Review the sources" description="This is everything the chat will know about the app. Adjust roles and what is sensitive, then accept." wide>
        <Review />
      </Dialog>
      <Dialog open={dialog?.kind === "skill"} onClose={close} title="Make your app Tomoe-ready" description="A skill for your coding agent: it adds what Tomoe looks for, read-only.">
        <SkillPanel />
      </Dialog>
    </>
  )
}

const KIND_LABEL: Record<string, string> = {
  homepage: "Website",
  tomoe: "Tomoe-ready",
  llms: "llms.txt",
  openapi: "OpenAPI",
  "service-desc": "API link in the page",
  "ai-plugin": "AI plugin manifest",
  mcp: "MCP server",
  graphql: "GraphQL",
  robots: "robots.txt",
  sitemap: "Sitemap",
}

export function ReconList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border/60 rounded-xl border bg-background/60">
      {findings.map((f, i) => (
        <li key={`${f.kind}-${i}`} className="flex animate-fade items-start gap-2.5 px-3 py-2 text-[13px]">
          {f.ok ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-positive" /> : <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />}
          <span className={cn("w-32 shrink-0 font-medium", !f.ok && "text-muted-foreground")}>{KIND_LABEL[f.kind] ?? f.kind}</span>
          <span className="min-w-0 flex-1 break-words text-muted-foreground">{f.note}</span>
          {f.ok && /^https?:/.test(f.url) && (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Open ${KIND_LABEL[f.kind] ?? f.kind}`}>
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

type Shot = { key: string; file: File; preview: string }

function ConnectForm({ initialUrl }: { initialUrl?: string }) {
  const { reloadApps, setDialog, app, reloadDetail } = useWorkspace()
  const [target, setTarget] = React.useState(initialUrl ?? "")
  const [website, setWebsite] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [openapi, setOpenapi] = React.useState("")
  const [repo, setRepo] = React.useState("")
  const [header, setHeader] = React.useState("Authorization")
  const [secret, setSecret] = React.useState("")
  const [name, setName] = React.useState("")
  const [shots, setShots] = React.useState<Shot[]>([])
  const [report, setReport] = React.useState<Recon | null>(null)
  const [testing, setTesting] = React.useState(false)
  const [busy, setBusy] = React.useState<null | "app" | "example" | "file">(null)
  const picker = React.useRef<HTMLInputElement>(null)
  const shotPicker = React.useRef<HTMLInputElement>(null)

  const test = async (value = target) => {
    if (!value.trim()) return
    setTesting(true)
    setReport(null)
    try {
      const r = await api.recon(value.trim())
      setReport(r)
      const s = r.suggested
      // Fill what is empty; what the user typed stays.
      if (s.website) setWebsite((v) => v || s.website!)
      if (s.api) setUrl((v) => v || s.api!)
      if (s.openapi) setOpenapi((v) => v || s.openapi!)
      if (s.name) setName((v) => v || s.name!)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  React.useEffect(() => {
    if (initialUrl) void test(initialUrl)
  }, [])

  const addShots = (files: File[]) =>
    setShots((cur) => [...cur, ...files.filter((f) => f.type.startsWith("image/")).map((file, i) => ({ key: `${Date.now()}-${i}`, file, preview: URL.createObjectURL(file) }))].slice(0, 10))

  const hostOf = (u: string) => {
    try {
      return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname
    } catch {
      return ""
    }
  }
  const typed = target.trim()
  const normalized = report?.origin ?? (typed && !/^https?:\/\//i.test(typed) ? `${/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(typed) ? "http" : "https"}://${typed}` : typed)
  const derivedName = name.trim() || report?.suggested.name || (repo.trim() ? repo.trim().split("/").filter(Boolean).at(-1) : hostOf(typed || url))
  const ready = !!report?.manifest
  const canConnect = !!(typed || website.trim() || url.trim() || openapi.trim() || repo.trim())

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy("app")
    try {
      // The URL the user gave is the website unless recon showed it is the API itself.
      const isApi = report && report.suggested.api && !report.suggested.website
      const created = await api.createApp(derivedName || "My app", {
        ...(website.trim() || (!isApi && normalized) ? { website: website.trim() || normalized } : {}),
        ...(url.trim() || (isApi && normalized) ? { url: url.trim() || normalized } : {}),
        ...(openapi.trim() ? { openapi: openapi.trim() } : {}),
        ...(repo.trim() ? { repo: repo.trim() } : {}),
        headers: secret.trim() && header.trim() ? { [header.trim()]: secret.trim() } : {},
      })
      if (shots.length) {
        const saved = await api.upload(created.id, shots.map((s) => s.file))
        await api.updateApp(created.id, { connection: { files: saved.map((f) => f.path) } })
      }
      await reloadApps(created.id)
      setDialog({ kind: "discover" })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const example = async () => {
    setBusy("example")
    try {
      const created = await api.createExample()
      await reloadApps(created.id)
      setDialog(null)
      toast.success("Example Shop is ready: orders and customers, made up.")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const dataFile = async (file: File | undefined) => {
    if (!file || !app) return
    setBusy("file")
    try {
      const [saved] = await api.upload(app.id, [file])
      await api.dataFile(app.id, saved.path)
      await reloadDetail()
      setDialog({ kind: "review" })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const mono = cn(inputClass, "font-mono text-[13px]")
  return (
    <div className="grid gap-0 md:grid-cols-[1fr_15rem]">
      <form onSubmit={connect} className="flex min-w-0 flex-col gap-4 p-5 md:border-r">
        <Field label="Website, web app or API" hint="Tomoe looks for llms.txt, OpenAPI, MCP, GraphQL and /.well-known/tomoe.json there first.">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <GlobeIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={cn(mono, "h-11 pl-9 text-sm")}
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value)
                  setReport(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void test()
                  }
                }}
                placeholder="https://app.example.com"
                spellCheck={false}
                autoFocus
              />
            </div>
            <Button type="button" variant="outline" className="h-11" onClick={() => void test()} disabled={!target.trim() || testing}>
              {testing ? <TomoeMark working className="size-4 text-primary" /> : <RadarIcon />}
              Test
            </Button>
          </div>
        </Field>

        {testing && <p className="animate-pulse text-[13px] text-muted-foreground">Looking at {hostOf(target)}…</p>}
        {report && (
          <div className="flex animate-rise flex-col gap-2">
            {ready ? (
              <p className="flex items-start gap-2 rounded-lg bg-positive/12 px-3 py-2 text-[13px]">
                <SparklesIcon className="mt-0.5 size-4 shrink-0 text-positive" />
                <span>
                  <strong>Tomoe-ready.</strong> It publishes its own manifest ({report.manifest!.sources.join(", ")}): connecting needs no discovery agent.
                </span>
              </p>
            ) : report.manifestProblem ? (
              <p className="rounded-lg bg-warning/12 px-3 py-2 text-[13px]">Its tomoe.json has a manifest Tomoe cannot use: {report.manifestProblem}</p>
            ) : null}
            <ReconList findings={report.findings} />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="API base URL" hint="GET requests only, on this origin only.">
            <input className={mono} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com" spellCheck={false} />
          </Field>
          <Field label="OpenAPI document">
            <input className={mono} value={openapi} onChange={(e) => setOpenapi(e.target.value)} placeholder="…/openapi.json" spellCheck={false} />
          </Field>
        </div>
        <Field label="Repository folder (optional)" hint="A local checkout: schemas, routes, models, design tokens.">
          <input className={mono} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="~/code/my-app" spellCheck={false} />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Screenshots (optional)</span>
          <div
            className="flex min-h-20 flex-wrap items-center gap-2 rounded-lg border border-dashed bg-background/60 p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              addShots([...e.dataTransfer.files])
            }}
            onPaste={(e) => addShots([...e.clipboardData.files])}
          >
            {shots.map((s) => (
              <div key={s.key} className="group relative h-16 w-24 overflow-hidden rounded-md border">
                <img src={s.preview} alt="" className="size-full object-cover" />
                <button type="button" aria-label="Remove screenshot" onClick={() => setShots((cur) => cur.filter((x) => x.key !== s.key))} className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => shotPicker.current?.click()} className="flex h-16 cursor-pointer items-center gap-2 rounded-md px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
              <ImagePlusIcon className="size-4" />
              {shots.length ? "Add more" : "Drop, paste or pick screens of the app: they show what matters"}
            </button>
            <input ref={shotPicker} type="file" accept="image/*" multiple hidden onChange={(e) => (addShots([...(e.target.files ?? [])]), (e.target.value = ""))} />
          </div>
        </div>

        <div className="grid grid-cols-[9rem_1fr] gap-2">
          <Field label="Auth header">
            <input className={mono} value={header} onChange={(e) => setHeader(e.target.value)} spellCheck={false} />
          </Field>
          <Field label="Value (optional)">
            <input className={mono} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Bearer …" autoComplete="off" />
          </Field>
        </div>
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={derivedName || "My app"} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" variant="primary" disabled={busy !== null || !canConnect}>
            {busy === "app" ? <TomoeMark working className="size-4" /> : <SparklesIcon />}
            {ready ? "Connect" : "Connect and discover"}
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldIcon className="size-3.5" />
            Read-only
          </span>
        </div>
      </form>
      <div className="flex flex-col gap-3 bg-muted/40 p-5">
        <QuickCard icon={<WandSparklesIcon />} title="Make your app Tomoe-ready" text="A skill for your coding agent: llms.txt, OpenAPI, a manifest, tomoe.json." action="Get the skill" busy={false} disabled={false} onClick={() => setDialog({ kind: "skill" })} accent />
        <QuickCard icon={<BoxIcon />} title="Example shop" text="Made-up orders and customers, ready in a second." action="Load the example" busy={busy === "example"} disabled={busy !== null} onClick={() => void example()} />
        <QuickCard icon={<DatabaseIcon />} title="A data file" text={`A CSV or JSON becomes a source of ${app?.name ?? "this app"}.`} action="Choose a file" busy={busy === "file"} disabled={busy !== null} onClick={() => picker.current?.click()} />
        <input ref={picker} type="file" accept=".csv,.tsv,.json" hidden onChange={(e) => void dataFile(e.target.files?.[0])} />
        <p className="mt-auto text-xs leading-relaxed text-muted-foreground">
          Try it: <code className="font-mono">pnpm example:server</code>, then test <code className="font-mono">http://127.0.0.1:8792</code>.
        </p>
      </div>
    </div>
  )
}

function SkillPanel() {
  const { skillRepo } = useWorkspace()
  const command = `npx skills add ${skillRepo} --skill tomoe-ready`
  const prompt = "Make this app Tomoe-ready."
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error("Copy failed: select the text instead")
    )
  return (
    <div className="flex flex-col gap-4 p-5 text-sm">
      <ol className="flex flex-col gap-4">
        <li className="flex flex-col gap-2">
          <span className="font-medium">1. In your app’s repo, install the skill</span>
          <CopyLine text={command} onCopy={() => void copy(command, "Command")} />
          <span className="text-xs text-muted-foreground">
            From <a className="text-primary underline underline-offset-2" href="https://skills.sh" target="_blank" rel="noopener noreferrer">skills.sh</a>; works with Claude Code, Codex, Cursor and other agents.
          </span>
        </li>
        <li className="flex flex-col gap-2">
          <span className="font-medium">2. Ask your coding agent</span>
          <CopyLine text={prompt} onCopy={() => void copy(prompt, "Prompt")} />
        </li>
        <li className="flex flex-col gap-1">
          <span className="font-medium">3. Deploy, then connect its URL here</span>
          <span className="text-xs text-muted-foreground">Test shows “Tomoe-ready”, and Connect uses the app’s own manifest: no guessing, no discovery agent.</span>
        </li>
      </ol>
      <div className="rounded-xl border bg-background/60 p-3.5">
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">What it adds, read-only</p>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {[
            ["/.well-known/tomoe.json", "points Tomoe to everything below"],
            ["tomoe.manifest.json", "sources, fields, roles, sensitive fields, deep links"],
            ["/openapi.json", "the read endpoints, generated from your code"],
            ["/llms.txt", "what the app is, for any agent"],
            ["GET list endpoints", "paginated JSON, only where missing"],
          ].map(([what, why]) => (
            <li key={what} className="flex gap-2">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-positive" />
              <span>
                <code className="font-mono text-[12px]">{what}</code> <span className="text-muted-foreground">· {why}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CopyLine({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{text}</code>
      <Button size="sm" variant="ghost" onClick={onCopy} aria-label="Copy">
        <CopyIcon />
        Copy
      </Button>
    </div>
  )
}

function QuickCard({ icon, title, text, action, onClick, busy, disabled, accent }: { icon: React.ReactNode; title: string; text: string; action: string; onClick: () => void; busy: boolean; disabled: boolean; accent?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3.5", accent && "border-kihada/50 bg-kihada/8")}>
      <div className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground">{text}</p>
      <Button size="sm" variant={accent ? "primary" : "outline"} onClick={onClick} disabled={disabled} className="self-start">
        {busy && <TomoeMark working className="size-4" />}
        {action}
      </Button>
    </div>
  )
}

function Discovery() {
  const { app, reloadDetail, setDialog } = useWorkspace()
  const [text, setText] = React.useState("")
  const [steps, setSteps] = React.useState<{ name: string; detail: string }[]>([])
  const [status, setStatus] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)
  const [findings, setFindings] = React.useState<Finding[]>([])
  const started = React.useRef(false)

  const run = React.useCallback((agent = false) => {
    if (!app) return () => {}
    const controller = new AbortController()
    setText("")
    setSteps([])
    setFindings([])
    setError(null)
    setRunning(true)
    stream(
      discoverPath(app.id, agent),
      {},
      (e) => {
        if (e.type === "text") setText((t) => t + e.text)
        else if (e.type === "block") setText((t) => (t ? `${t}\n\n` : t))
        else if (e.type === "tool") setSteps((s) => [...s, { name: e.name, detail: e.detail }])
        else if (e.type === "status") setStatus(e.text)
        else if (e.type === "recon") setFindings(e.findings)
        else if (e.type === "final") setText(e.text)
        else if (e.type === "error") setError(e.message)
        else if (e.type === "manifest") void reloadDetail().then(() => setDialog({ kind: "review" }))
      },
      controller.signal
    )
      .catch((e: Error) => !controller.signal.aborted && setError(e.message))
      .finally(() => {
        setRunning(false)
        setStatus(null)
      })
    return () => controller.abort()
  }, [app, reloadDetail, setDialog])

  React.useEffect(() => {
    if (started.current) return
    started.current = true
    return run()
  }, [run])

  const shown = text.replace(/```manifest[\s\S]*$/, "").trim()
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <TomoeMark working={running} accent={running} className="size-7 text-primary" />
        <div className="min-w-0">
          <p className="font-medium">{running ? (status ?? "Reading…") : error ? "Discovery stopped" : "Done"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[app?.connection.website, app?.connection.url, app?.connection.repo].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {findings.length > 0 && <ReconList findings={findings} />}
      {steps.length > 0 && (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-[11.5px] text-muted-foreground">
          {steps.map((s, i) => (
            <li key={i} className="flex animate-fade gap-2">
              <span className="shrink-0 text-foreground/80">{s.name}</span>
              <span className="truncate">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {shown && <Markdown text={shown} className="text-sm" />}
      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-negative/10 px-3 py-2 text-[13px] text-negative">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {!running && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => run()}>
            Run again
          </Button>
          {findings.some((f) => f.kind === "tomoe" && f.ok) && (
            <Button size="sm" variant="ghost" onClick={() => run(true)}>
              Let the agent read it anyway
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

type Draftable = Manifest

function Review() {
  const { detail, app, reloadDetail, setDialog, setView } = useWorkspace()
  const original = (detail?.draft?.manifest ?? detail?.manifest) as Draftable | undefined
  const [m, setM] = React.useState<Draftable | undefined>(original)
  const [skip, setSkip] = React.useState<Set<string>>(new Set())
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => {
    setM(original)
    setSkip(new Set())
  }, [original])
  if (!m || !app) return <p className="p-5 text-sm text-muted-foreground">Nothing to review yet.</p>

  const editField = (si: number, fi: number, patch: Record<string, unknown>) =>
    setM((cur) => cur && { ...cur, sources: cur.sources.map((s, i) => (i !== si ? s : { ...s, fields: s.fields.map((f, j) => (j !== fi ? f : { ...f, ...patch })) })) })

  const accept = async () => {
    setSaving(true)
    try {
      const sources = m.sources.filter((s) => !skip.has(s.id))
      const ids = new Set(sources.map((s) => s.id))
      await api.acceptManifest(app.id, {
        ...m,
        sources: sources.map((s) => ({ ...s, relations: s.relations.filter((r) => ids.has(r.to)) })),
        actions: m.actions.filter((a) => !a.source || ids.has(a.source)),
      })
      await reloadDetail()
      setDialog(null)
      setView("focus")
      toast.success(`${app.name} is connected: ask for a widget.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      {!!detail?.draft?.problems.length && (
        <div className="mx-5 mt-5 flex flex-col gap-1 rounded-lg bg-warning/12 px-3 py-2.5 text-[13px]">
          <p className="font-medium">The probe found things to check</p>
          <ul className="list-disc pl-4 text-muted-foreground">
            {detail.draft.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-4 p-5">
        {m.sources.length === 0 && <p className="text-sm text-muted-foreground">No sources yet.</p>}
        {m.sources.map((s, si) => (
          <section key={s.id} className={cn("overflow-hidden rounded-xl border transition-opacity", skip.has(s.id) && "opacity-50")}>
            <header className="flex flex-wrap items-center gap-2 bg-muted/40 px-3.5 py-2.5">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={!skip.has(s.id)}
                onChange={(e) =>
                  setSkip((cur) => {
                    const next = new Set(cur)
                    if (e.target.checked) next.delete(s.id)
                    else next.add(s.id)
                    return next
                  })
                }
                aria-label={`Use ${s.label}`}
              />
              <span className="font-display font-bold">{s.label}</span>
              <code className="font-mono text-xs text-muted-foreground">{s.id}</code>
              <Badge tone="outline" className="ml-auto font-mono">
                {s.origin.kind === "rest" ? (
                  <>
                    <GlobeIcon className="size-3" />
                    GET {s.origin.path}
                  </>
                ) : s.origin.kind === "memory" ? (
                  <>
                    <DatabaseIcon className="size-3" />
                    stored rows
                  </>
                ) : (
                  s.origin.kind
                )}
              </Badge>
            </header>
            {s.description && <p className="px-3.5 pt-2 text-xs text-muted-foreground">{s.description}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="px-3.5 py-2 font-medium">Field</th>
                    <th className="px-2 py-2 font-medium">Label</th>
                    <th className="px-2 py-2 font-medium">Type</th>
                    <th className="px-2 py-2 font-medium">Role</th>
                    <th className="px-3.5 py-2 text-right font-medium">Sensitive</th>
                  </tr>
                </thead>
                <tbody>
                  {s.fields.map((f, fi) => (
                    <tr key={f.name} className="border-t border-border/60">
                      <td className="px-3.5 py-1.5 font-mono text-xs">{f.name}</td>
                      <td className="px-2 py-1">
                        <input className="w-full min-w-28 rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-border focus:border-primary focus:outline-none" value={f.label} onChange={(e) => editField(si, fi, { label: e.target.value })} aria-label={`Label of ${f.name}`} />
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {f.type}
                        {f.values ? ` · ${f.values.length}` : ""}
                      </td>
                      <td className="px-2 py-1">
                        <select className="rounded-md border bg-card px-1.5 py-1 text-xs" value={f.role} onChange={(e) => editField(si, fi, { role: e.target.value })} aria-label={`Role of ${f.name}`}>
                          {FIELD_ROLES.map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3.5 py-1 text-right">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={f.sensitive}
                          aria-label={`${f.name} is sensitive`}
                          onClick={() => editField(si, fi, { sensitive: !f.sensitive })}
                          className={cn("inline-flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors", f.sensitive ? "bg-kihada/25 text-foreground" : "text-muted-foreground hover:bg-muted")}
                        >
                          {f.sensitive && <EyeOffIcon className="size-3" />}
                          {f.sensitive ? "Hidden" : "Visible"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {m.actions.length > 0 && (
          <div className="text-[13px]">
            <p className="mb-1 font-medium">Actions (open the app’s own screens)</p>
            <ul className="flex flex-wrap gap-1.5">
              {m.actions.map((a) => (
                <Badge key={a.id} tone="outline" className="font-mono">
                  {a.label} → {a.target}
                </Badge>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-card px-5 py-3">
        <Button variant="primary" onClick={() => void accept()} disabled={saving || !m.sources.some((s) => !skip.has(s.id))}>
          {saving && <TomoeMark working className="size-4" />}
          Accept {m.sources.length - skip.size} {m.sources.length - skip.size === 1 ? "source" : "sources"}
        </Button>
        {detail?.draft && (
          <Button
            variant="ghost"
            onClick={() =>
              void api.discardDraft(app.id).then(async () => {
                await reloadDetail()
                setDialog(null)
              })
            }
          >
            Discard draft
          </Button>
        )}
        {app.kind === "connected" && (
          <Button variant="ghost" className="ml-auto" onClick={() => setDialog({ kind: "discover" })}>
            Run discovery again
          </Button>
        )}
      </footer>
    </div>
  )
}
