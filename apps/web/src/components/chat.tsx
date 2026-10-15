/**
 * The chat: full screen at first (a hero with the composer), then a conversation; beside the board it
 * becomes a panel. Answers stream in; widget blocks become live proposals as soon as they close.
 */
import * as React from "react"
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, HistoryIcon, ImageUpIcon, PlusIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react"
import { answerWidgets, asksToConfirm, type Manifest, stripBlocks } from "@tomoe/core"

import { Composer, type ComposerHandle } from "@/components/composer"
import { Markdown } from "@/components/markdown"
import { Proposal } from "@/components/proposal"
import { Mascot } from "@/components/mascot"
import { Badge, Button, cn, DoneCheck, Gauge, Kbd, Label, TomoeMark, useRipples } from "@/components/ui"
import { api } from "@/lib/api"
import { type LiveMessage, useChat } from "@/lib/chat"
import { useMascotWork } from "@/lib/mascot"
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
  useMascotWork("chat", chat.busy, !!chat.messages[chat.messages.length - 1]?.error)
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
        <div className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl animate-rise items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2.5 text-[13px]">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            Claude Code was not found on this machine. Install it and log in with your Claude subscription (<code className="font-mono">claude</code>, then <code className="font-mono">/login</code>), then restart Tomoe.
          </span>
        </div>
      )}

      {empty && mode === "focus" ? (
        <Hero busy={chat.busy} manifest={tomoe?.manifest} onPick={(t) => composer.current?.setText(t, true)}>
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
            <div className={cn("mx-auto flex w-full flex-col gap-7 px-4 py-7", mode === "focus" ? "max-w-3xl" : "max-w-none")}>
              {aboutWidget && (
                <div className="flex animate-pop items-center gap-2 self-start rounded-full border border-foreground/25 py-1 pr-1 pl-3 text-xs">
                  <span className="label-caps">Changing</span> {aboutWidget.title}
                  <button type="button" aria-label="Stop changing this widget" className="flex size-5 cursor-pointer items-center justify-center rounded-full transition-[background-color,transform] hover:rotate-90 hover:bg-muted" onClick={() => chat.fresh()}>
                    <XIcon className="size-3" />
                  </button>
                </div>
              )}
              {empty && <PanelEmpty onPick={(t) => composer.current?.setText(t, true)} manifest={tomoe?.manifest} />}
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
              <p className="mt-2.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">{board.widgets.length}</span> {board.widgets.length === 1 ? "widget" : "widgets"} on the board
                <span className="h-3 w-px bg-border" />
                <button type="button" className="group/open flex cursor-pointer items-center gap-1 font-medium text-foreground underline decoration-accent underline-offset-4 transition-colors hover:decoration-foreground" onClick={() => setView("board")}>
                  Open it <ArrowRightIcon className="size-3 transition-transform group-hover/open:translate-x-0.5" />
                </button>
              </p>
            )}
          </div>
        </>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 flex animate-fade flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-foreground/60 bg-background/85 backdrop-blur-sm">
          <ImageUpIcon className="size-8 animate-[mascot-jump_1.4s_ease-in-out_infinite]" />
          <span className="label-caps text-foreground!">Drop to attach</span>
          <p className="text-sm text-muted-foreground">Screenshots and sketches become widgets; CSV and JSON can become data.</p>
        </div>
      )}
    </div>
  )
}

function Hero({ busy, manifest, onPick, children }: { busy: boolean; manifest?: Manifest; onPick: (t: string) => void; children: React.ReactNode }) {
  const { app, setDialog, board, setView, privacy, setPrivacy } = useWorkspace()
  const connected = !!manifest?.sources.length
  const field = React.useRef<HTMLDivElement>(null)
  const widgets = board?.widgets.length ?? 0
  const sources = manifest?.sources.length ?? 0

  // Darker dots gather around the pointer, as if it were a lens over the paper.
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = field.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty("--mx", `${e.clientX - r.left}px`)
    el.style.setProperty("--my", `${e.clientY - r.top}px`)
    el.style.setProperty("--lens", "1")
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" onPointerMove={onMove} onPointerLeave={() => field.current?.style.setProperty("--lens", "0")}>
      <div ref={field} className="dot-field" aria-hidden />
      <TomoeMark working={busy} className="pointer-events-none absolute top-1/2 left-1/2 size-[min(92vw,760px)] -translate-x-1/2 -translate-y-[54%] text-foreground opacity-[0.013] [animation-duration:24s] dark:opacity-[0.018]" />
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pt-6 pb-[6vh]">
        <div className="stagger flex w-full max-w-2xl flex-col items-center gap-5">
          <Mascot size={84} roam={320} />
          <button
            type="button"
            onClick={() => setDialog({ kind: "connect" })}
            className="group/status flex cursor-pointer items-center gap-2.5 rounded-full border border-foreground/15 bg-card/70 py-1.5 pr-3.5 pl-2.5 backdrop-blur transition-[border-color,background-color] hover:border-foreground/50 hover:bg-card active:scale-[0.98]"
          >
            <span className={cn("relative flex size-2 rounded-full", connected ? "bg-foreground" : "border border-foreground/60")}>
              {connected && <span className="absolute inset-0 animate-ping rounded-full bg-foreground/40 [animation-duration:2.4s]" />}
            </span>
            <span className="label-caps text-foreground!">{app?.name ?? "…"}</span>
            <span className="h-3 w-px bg-border" />
            <span className="text-xs text-muted-foreground transition-colors group-hover/status:text-foreground">
              {connected ? (
                `${sources} ${sources === 1 ? "source" : "sources"} connected`
              ) : (
                <>
                  Nothing connected yet<span className="hidden sm:inline">: connect a website, an API, a repo or a file</span>
                </>
              )}
            </span>
            <ArrowRightIcon className="size-3 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover/status:translate-x-0 group-hover/status:opacity-100" />
          </button>
          <div className="flex flex-col items-center gap-4">
            <h1 className="text-center font-display text-[clamp(1.9rem,5.2vw,3.25rem)] leading-[1.08] font-normal tracking-[-0.025em] text-balance">What should we build today?</h1>
            <span className="rule-draw" />
          </div>
          <p className="max-w-lg text-center text-[15px] leading-relaxed text-pretty text-muted-foreground">
            Describe a view, drop a screenshot of one, or paste a link. Tomoe designs it {connected ? <>on <span className="text-foreground">{manifest!.app.name}</span>’s live data</> : "as a working interface"}; you choose what goes on the board.
          </p>
          <div className="w-full pt-1">{children}</div>
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <span className="label-caps mr-1">Try</span>
            {suggestions(manifest).map((s) => (
              <Chip key={s} onClick={() => onPick(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <footer className="relative hidden shrink-0 border-t border-border/70 [@media(min-height:720px)]:sm:flex">
        <SheetCell label="Sources" value={String(sources)} note={connected ? manifest!.sources.slice(0, 2).map((s) => s.label).join(", ") : "none yet"} onClick={() => setDialog({ kind: connected ? "review" : "connect" })} />
        <SheetCell label="Board" value={String(widgets)} note={widgets === 1 ? "widget" : "widgets"} onClick={() => setView("board")} kbd="B" />
        <SheetCell label="Privacy" value={privacy ? "ON" : "OFF"} note={privacy ? "sensitive values hidden" : "values shown"} onClick={() => setPrivacy(!privacy)} kbd="P">
          <Gauge value={privacy ? 100 : 0} className="h-2! w-16" />
        </SheetCell>
      </footer>
    </div>
  )
}

/** One column of the sheet under the landing: a tracked label, a number, a note. */
function SheetCell({ label, value, note, onClick, kbd, children }: { label: string; value: string; note: string; onClick: () => void; kbd?: string; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="group/cell flex min-w-0 flex-1 cursor-pointer flex-col gap-2.5 border-r border-border/70 px-6 py-4 text-left transition-colors last:border-r-0 hover:bg-card/60">
      <span className="flex h-4.5 items-center justify-between gap-2">
        <span className="label-caps transition-colors group-hover/cell:text-foreground">{label}</span>
        {kbd && <Kbd>{kbd}</Kbd>}
      </span>
      <span className="flex items-center gap-3">
        <span key={value} className="animate-fade font-display text-xl font-normal">{value}</span>
        {children}
        <span className="truncate text-xs text-muted-foreground">{note}</span>
      </span>
    </button>
  )
}

/** A suggestion: an outlined pill that fills with ink on hover. */
function Chip({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  const ripples = useRipples()
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={ripples.onPointerDown}
      className={cn(
        "relative isolate cursor-pointer overflow-hidden rounded-[1rem] border border-foreground/25 bg-card/50 px-3.5 py-1.5 text-left text-[12.5px] text-foreground/85 transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px hover:border-foreground hover:bg-foreground hover:text-background active:translate-y-0 active:scale-[0.97]",
        className
      )}
    >
      {children}
      {ripples.node}
    </button>
  )
}

function PanelEmpty({ manifest, onPick }: { manifest?: Manifest; onPick: (t: string) => void }) {
  return (
    <div className="stagger flex flex-col gap-4 py-6">
      <div className="flex items-end justify-between gap-3">
        <Label rule>New chat</Label>
        <Mascot size={40} />
      </div>
      <p className="font-display text-xl font-normal tracking-tight">Ask for a widget</p>
      <p className="text-sm text-muted-foreground">It appears here as a live preview. Nothing reaches the board until you add it.</p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions(manifest).map((s) => (
          <Chip key={s} onClick={() => onPick(s)}>
            {s}
          </Chip>
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
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-full px-2.5 py-1 text-sm font-medium transition-colors hover:bg-muted active:scale-[0.98]" aria-expanded={open}>
        <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
        <span key={current?.id ?? "new"} className="animate-fade truncate">{current?.title ?? (chat.messages.length ? "This chat" : "New chat")}</span>
        <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" onClick={() => chat.fresh()} disabled={!chat.messages.length} className="hover:[&_svg]:rotate-90 [&_svg]:transition-transform [&_svg]:duration-300">
        <PlusIcon />
        New chat
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-3 z-40 mt-1 w-80 origin-top-left animate-[dialog-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-xl border bg-card p-1 shadow-soft">
            <p className="label-caps px-2.5 pt-2.5 pb-2">History</p>
            {chat.history.length === 0 && <p className="px-3 pb-2 text-sm text-muted-foreground">No earlier chats.</p>}
            <ul className="stagger max-h-80 overflow-y-auto">
              {chat.history.map((h) => (
                <li key={h.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      void chat.open(h.id)
                      setOpen(false)
                    }}
                    className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-[background-color,padding] duration-200 hover:bg-muted hover:pl-3.5", h.id === chat.chatId && "font-medium")}
                  >
                    {h.id === chat.chatId ? <CheckIcon className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                    <span className="truncate">{h.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground uppercase">{new Date(h.updated).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
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
    <div className="flex origin-bottom-right animate-enter-right flex-col items-end gap-2">
      {!!message.files?.length && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {message.files.map((f) =>
            f.image && app ? (
              <a key={f.path} href={api.fileUrl(app.id, f.path)} target="_blank" rel="noopener noreferrer" className="overflow-hidden rounded-lg border bg-card transition-transform hover:-rotate-1 hover:scale-[1.02]">
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
      {message.text !== "(attachments)" && <div className="max-w-[85%] rounded-[1.25rem] rounded-br-md bg-foreground px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-background">{message.text}</div>}
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

  // "Done" once, when this answer finishes in front of the user (not for answers loaded from history).
  const [done, setDone] = React.useState(false)
  const was = React.useRef(message.streaming)
  React.useEffect(() => {
    const finished = was.current && !message.streaming && !message.error
    was.current = message.streaming
    if (!finished) return
    setDone(true)
    const t = setTimeout(() => setDone(false), 2600)
    return () => clearTimeout(t)
  }, [message.streaming, message.error])

  return (
    <div className="flex animate-enter-left gap-3">
      <div className="flex shrink-0 flex-col items-center pt-1">
        <TomoeMark working={message.streaming} accent={message.streaming} className={cn("size-4.5 text-foreground transition-opacity", !message.streaming && "opacity-70")} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {message.tools.length > 0 && <ToolSteps tools={message.tools} live={!!message.streaming} />}
        {working && (
          <div className="flex animate-fade items-center gap-3">
            <Mascot size={28} label={false} />
            <div className="flex flex-col gap-1.5">
              <span key={message.status ?? message.tools.length} className="label-caps animate-fade">{message.status ?? (message.tools.length ? "Working on it" : "Thinking")}</span>
              <Gauge className="h-1.5! w-28" />
            </div>
          </div>
        )}
        {text && <Markdown text={text} className={cn("text-[15px]", message.streaming && !widgets.length && "streaming-caret")} />}
        {message.status && !working && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
            {message.status}
          </p>
        )}
        {widgets.map((w) => (
          <Proposal key={w.id} widget={w} />
        ))}
        {notes.map((n) => (
          <p key={n} className="flex animate-rise items-start gap-2 rounded-lg border-l-2 border-accent bg-accent/15 px-3 py-2 text-[13px]">
            {n}
          </p>
        ))}
        {confirm && (
          <div className="stagger flex flex-wrap gap-2">
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
          <div role="alert" className="flex animate-shake items-start gap-2.5 rounded-lg border border-negative/25 bg-negative/[0.06] px-3 py-2.5 text-[13px] text-negative">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="label-caps text-negative!">Stopped</span>
              <span className="error-underline self-start pb-0.5 break-words">{message.error}</span>
            </div>
          </div>
        )}
        {done && (
          <span className="flex animate-fade items-center gap-2 text-foreground" aria-live="polite">
            <DoneCheck className="size-4" />
            <span className="label-caps text-foreground!">Done</span>
          </span>
        )}
      </div>
    </div>
  )
}

function ToolSteps({ tools, live }: { tools: { name: string; detail: string }[]; live: boolean }) {
  const [open, setOpen] = React.useState(false)
  const shown = open || live ? tools.slice(-6) : []
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="group/steps flex cursor-pointer items-center gap-1.5 self-start" aria-expanded={open || live}>
        <ChevronDownIcon className={cn("size-3 text-muted-foreground transition-transform duration-300", !(open || live) && "-rotate-90")} />
        <span className="label-caps transition-colors group-hover/steps:text-foreground">
          <span className="font-mono tracking-normal">{tools.length}</span> {tools.length === 1 ? "step" : "steps"}
        </span>
      </button>
      {shown.length > 0 && (
        <ul className="ml-1.5 flex flex-col gap-1 border-l border-foreground/15 pl-3">
          {shown.map((t, i) => (
            <li key={tools.length - shown.length + i} className="relative flex min-w-0 animate-enter-left gap-2 font-mono text-[11.5px] text-muted-foreground">
              <span className={cn("absolute top-1/2 -left-[15.5px] size-1.5 -translate-y-1/2 rounded-full border border-foreground/40 bg-background", live && i === shown.length - 1 && "animate-pulse border-foreground bg-foreground")} />
              <span className="shrink-0 text-foreground/85">{TOOL_LABEL[t.name] ?? t.name}</span>
              <span className="truncate">{t.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
