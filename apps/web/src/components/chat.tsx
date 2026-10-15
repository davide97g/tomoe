/**
 * The chat: full screen at first (a hero with the composer), then a conversation; beside the board it
 * becomes a panel. Answers stream in; widget blocks become live proposals as soon as they close.
 */
import * as React from "react"
import { CheckIcon, ChevronDownIcon, HistoryIcon, ImageUpIcon, PlusIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react"
import { answerWidgets, asksToConfirm, type Manifest, stripBlocks } from "@tomoe/core"

import { Composer, type ComposerHandle } from "@/components/composer"
import { Markdown } from "@/components/markdown"
import { Proposal } from "@/components/proposal"
import { Badge, Button, cn, TomoeMark } from "@/components/ui"
import { api } from "@/lib/api"
import { type LiveMessage, useChat } from "@/lib/chat"
import { useWorkspace } from "@/lib/workspace"

const NOTE = /^(⚠️|🧩) .*$/gmu

function suggestions(m: Manifest | undefined): string[] {
  if (!m?.sources.length) {
    return ["A pricing page with three tiers, the middle one highlighted", "A launch countdown with a progress ring", "A kanban board for a small team, with sample cards"]
  }
  const out: string[] = []
  const timed = m.sources.find((s) => s.time && s.fields.some((f) => f.role === "measure"))
  if (timed) out.push(`${timed.fields.find((f) => f.role === "measure")!.label} by month over the last year`)
  const grouped = m.sources.find((s) => s.fields.some((f) => f.role === "dimension"))
  if (grouped) out.push(`${grouped.label} by ${grouped.fields.find((f) => f.role === "dimension")!.label.toLowerCase()}`)
  out.push(`A Monday-morning dashboard for ${m.app.name}`)
  if (m.sources[0]) out.push(`The latest ${m.sources[0].label.toLowerCase()} as a list`)
  return out.slice(0, 4)
}

const TOOL_LABEL: Record<string, string> = {
  run_query: "Queried",
  distinct: "Looked up values",
  read_board: "Read the board",
  describe_sources: "Read the sources",
  Read: "Read",
  Grep: "Searched",
  Glob: "Listed",
  WebFetch: "Opened",
  http_get: "Fetched",
  check_manifest: "Checked the manifest",
}

export function Chat({ mode }: { mode: "focus" | "panel" }) {
  const { app, tomoe, claude, chatRequest, board, setView } = useWorkspace()
  const chat = useChat(app?.id ?? "playground")
  const composer = React.useRef<ComposerHandle>(null)
  const scroller = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const pinned = React.useRef(true)
  const empty = chat.messages.length === 0
  const aboutWidget = chat.about?.startsWith("widget:") ? board?.widgets.find((w) => w.id === chat.about!.slice(7)) : undefined

  // "Ask for a change" on a widget, a Button's question, a sandbox's question: offered, never sent.
  React.useEffect(() => {
    if (!chatRequest) return
    if (chatRequest.about) chat.fresh(chatRequest.about)
    composer.current?.setText(chatRequest.text ?? "")
    requestAnimationFrame(() => composer.current?.focus())
  }, [chatRequest])

  // Follow the answer while it streams, unless the user scrolled up.
  React.useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [chat.messages])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && chat.busy) chat.stop()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [chat])

  const send = (text: string, files: Parameters<typeof chat.send>[1]) => {
    pinned.current = true
    void chat.send(text || (files?.length ? "Build this." : ""), files)
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        composer.current?.addFiles([...e.dataTransfer.files])
      }}
    >
      <ChatBar chat={chat} mode={mode} />
      {!claude && (
        <div className="mx-auto mt-3 flex w-full max-w-3xl items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-[13px]">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            Claude Code was not found on this machine. Install it and log in with your Claude subscription (<code className="font-mono">claude</code>, then <code className="font-mono">/login</code>), then restart Tomoe.
          </span>
        </div>
      )}

      {empty && mode === "focus" ? (
        <Hero busy={chat.busy} manifest={tomoe?.manifest} onPick={(t) => composer.current?.setText(t)}>
          <Composer ref={composer} big busy={chat.busy} onSend={send} onStop={chat.stop} placeholder={`Describe what you want to see${tomoe?.manifest.sources.length ? ` in ${tomoe.manifest.app.name}` : ""}…`} />
        </Hero>
      ) : (
        <>
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className={cn("mx-auto flex w-full flex-col gap-6 px-4 py-6", mode === "focus" ? "max-w-3xl" : "max-w-none")}>
              {aboutWidget && (
                <div className="flex items-center gap-2 self-start rounded-full bg-primary/8 py-1 pr-1 pl-3 text-xs text-primary">
                  Changing “{aboutWidget.title}”
                  <button type="button" aria-label="Stop changing this widget" className="flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-primary/15" onClick={() => chat.fresh()}>
                    <XIcon className="size-3" />
                  </button>
                </div>
              )}
              {empty && <PanelEmpty onPick={(t) => composer.current?.setText(t)} manifest={tomoe?.manifest} />}
              {chat.messages.map((m, i) =>
                m.role === "user" ? (
                  <UserMessage key={i} message={m} />
                ) : (
                  <AssistantMessage key={i} message={m} last={i === chat.messages.length - 1} onConfirm={(yes) => send(yes ? "Yes, go ahead in creative mode." : "No, keep to the components.", [])} />
                )
              )}
            </div>
          </div>
          <div className={cn("mx-auto w-full px-4 pb-4", mode === "focus" ? "max-w-3xl" : "")}>
            <Composer ref={composer} busy={chat.busy} onSend={send} onStop={chat.stop} placeholder={aboutWidget ? `What should change in “${aboutWidget.title}”?` : undefined} />
            {mode === "focus" && board && board.widgets.length > 0 && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {board.widgets.length} {board.widgets.length === 1 ? "widget" : "widgets"} on the board ·{" "}
                <button type="button" className="cursor-pointer font-medium text-primary hover:underline" onClick={() => setView("board")}>
                  open it
                </button>
              </p>
            )}
          </div>
        </>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex animate-fade flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-sm">
          <ImageUpIcon className="size-8 text-primary" />
          <p className="font-display text-xl font-bold">Drop to attach</p>
          <p className="text-sm text-muted-foreground">Screenshots and sketches become widgets; CSV and JSON can become data.</p>
        </div>
      )}
    </div>
  )
}

function Hero({ busy, manifest, onPick, children }: { busy: boolean; manifest?: Manifest; onPick: (t: string) => void; children: React.ReactNode }) {
  const { app, setDialog } = useWorkspace()
  const connected = !!manifest?.sources.length
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-[8vh]">
      <TomoeMark working={busy} className="pointer-events-none absolute inset-0 m-auto size-[min(84vw,680px)] text-primary opacity-[0.045] [animation-duration:18s]" />
      <div className="relative flex w-full max-w-2xl animate-rise flex-col items-center gap-6">
        <button
          type="button"
          onClick={() => setDialog({ kind: "connect" })}
          className="flex cursor-pointer items-center gap-2 rounded-full border bg-card/70 py-1 pr-3 pl-1.5 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          <span className={cn("size-2 rounded-full", connected ? "bg-positive" : "bg-kihada")} />
          <span className="font-medium text-foreground">{app?.name}</span>
          {connected ? `${manifest!.sources.length} ${manifest!.sources.length === 1 ? "source" : "sources"} connected` : "nothing connected · connect a website, an API, a repo or a file"}
        </button>
        <h1 className="text-center font-display text-[clamp(2.2rem,6vw,3.6rem)] leading-[1.05] font-bold tracking-tight text-balance">
          What should we <span className="relative whitespace-nowrap text-primary">build<svg viewBox="0 0 120 8" className="absolute -bottom-1.5 left-0 h-2 w-full text-kihada" preserveAspectRatio="none" aria-hidden><path d="M2 5.5C30 1.5 80 1.5 118 4.5" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" /></svg></span> today?
        </h1>
        <p className="max-w-lg text-center text-[15px] leading-relaxed text-pretty text-muted-foreground">
          Describe a view, drop a screenshot of one, or paste a link. Tomoe designs it {connected ? <>on <span className="text-foreground">{manifest!.app.name}</span>’s live data</> : "as a working interface"}; you choose what goes on the board.
        </p>
        <div className="w-full">{children}</div>
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions(manifest).map((s) => (
            <button key={s} type="button" onClick={() => onPick(s)} className="cursor-pointer rounded-full border bg-card/60 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PanelEmpty({ manifest, onPick }: { manifest?: Manifest; onPick: (t: string) => void }) {
  return (
    <div className="flex flex-col gap-3 py-6">
      <TomoeMark className="size-8 text-primary" accent />
      <p className="font-display text-xl font-bold">Ask for a widget</p>
      <p className="text-sm text-muted-foreground">It appears here as a live preview. Nothing reaches the board until you add it.</p>
      <div className="flex flex-col items-start gap-1.5">
        {suggestions(manifest).map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className="cursor-pointer text-left text-[13px] text-primary hover:underline">
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function ChatBar({ chat, mode }: { chat: ReturnType<typeof useChat>; mode: "focus" | "panel" }) {
  const [open, setOpen] = React.useState(false)
  const current = chat.history.find((h) => h.id === chat.chatId)
  if (mode === "focus" && !chat.messages.length && !chat.history.length) return null
  return (
    <div className={cn("relative flex items-center gap-1 px-3 py-2", mode === "panel" ? "border-b" : "mx-auto w-full max-w-3xl")}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted">
        <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current?.title ?? (chat.messages.length ? "This chat" : "New chat")}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" onClick={() => chat.fresh()} disabled={!chat.messages.length}>
        <PlusIcon />
        New chat
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-3 z-40 mt-1 w-80 animate-rise overflow-hidden rounded-xl border bg-card p-1 shadow-soft">
            {chat.history.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No earlier chats.</p>}
            <ul className="max-h-80 overflow-y-auto">
              {chat.history.map((h) => (
                <li key={h.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      void chat.open(h.id)
                      setOpen(false)
                    }}
                    className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted", h.id === chat.chatId && "font-medium")}
                  >
                    {h.id === chat.chatId ? <CheckIcon className="size-3.5 shrink-0 text-primary" /> : <span className="size-3.5 shrink-0" />}
                    <span className="truncate">{h.title}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{new Date(h.updated).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  </button>
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete ${h.title}`} onClick={() => void chat.forget(h.id)}>
                    <Trash2Icon className="size-3.5!" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function UserMessage({ message }: { message: LiveMessage }) {
  const { app } = useWorkspace()
  return (
    <div className="flex animate-rise flex-col items-end gap-2">
      {!!message.files?.length && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {message.files.map((f) =>
            f.image && app ? (
              <a key={f.path} href={api.fileUrl(app.id, f.path)} target="_blank" rel="noopener noreferrer" className="overflow-hidden rounded-lg border bg-card">
                <img src={api.fileUrl(app.id, f.path)} alt={f.name} className="h-28 max-w-56 object-cover" />
              </a>
            ) : (
              <Badge key={f.path} tone="outline" className="h-7 px-2.5">
                {f.name}
              </Badge>
            )
          )}
        </div>
      )}
      {message.text !== "(attachments)" && <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-primary-foreground">{message.text}</div>}
    </div>
  )
}

function AssistantMessage({ message, last, onConfirm }: { message: LiveMessage; last: boolean; onConfirm: (yes: boolean) => void }) {
  const { tomoe } = useWorkspace()
  const notes = message.streaming ? [] : [...message.text.matchAll(NOTE)].map((m) => m[0])
  const text = stripBlocks(message.text).replace(NOTE, "").replace(/\n{3,}/g, "\n\n").trim()
  const widgets = React.useMemo(() => (tomoe ? answerWidgets(message.text, tomoe.parseWidget) : []), [message.text, tomoe])
  const confirm = !message.streaming && last && asksToConfirm(message.text)
  const working = message.streaming && !text && !widgets.length
  return (
    <div className="flex gap-3">
      <TomoeMark working={message.streaming} accent={message.streaming} className={cn("mt-1 size-5 shrink-0 text-primary", !message.streaming && "opacity-80")} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {message.tools.length > 0 && <ToolSteps tools={message.tools} live={!!message.streaming} />}
        {working && <p className="animate-pulse text-sm text-muted-foreground">{message.status ?? (message.tools.length ? "Working on it…" : "Thinking…")}</p>}
        {text && <Markdown text={text} className="text-[15px]" />}
        {message.status && !working && <p className="animate-pulse text-xs text-muted-foreground">{message.status}</p>}
        {widgets.map((w) => (
          <Proposal key={w.id} widget={w} />
        ))}
        {notes.map((n) => (
          <p key={n} className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[13px]">
            {n}
          </p>
        ))}
        {confirm && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => onConfirm(true)}>
              <TomoeMark className="size-4" accent />
              Yes, use creative mode
            </Button>
            <Button size="sm" variant="outline" onClick={() => onConfirm(false)}>
              No, keep to components
            </Button>
          </div>
        )}
        {message.error && (
          <p className="flex items-start gap-2 rounded-lg bg-negative/10 px-3 py-2 text-[13px] text-negative">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {message.error}
          </p>
        )}
      </div>
    </div>
  )
}

function ToolSteps({ tools, live }: { tools: { name: string; detail: string }[]; live: boolean }) {
  const [open, setOpen] = React.useState(false)
  const shown = open || live ? tools.slice(-6) : []
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex cursor-pointer items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground">
        <ChevronDownIcon className={cn("size-3 transition-transform", !(open || live) && "-rotate-90")} />
        {tools.length} {tools.length === 1 ? "step" : "steps"}
      </button>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-l pl-3">
          {shown.map((t, i) => (
            <li key={i} className="flex min-w-0 animate-fade gap-2 font-mono text-[11.5px] text-muted-foreground">
              <span className="shrink-0 text-foreground/80">{TOOL_LABEL[t.name] ?? t.name}</span>
              <span className="truncate">{t.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
