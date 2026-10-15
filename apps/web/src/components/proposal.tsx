/**
 * A widget the agent proposes: a live preview on the real data, the version on the board to compare with
 * when it is an update, and the button that saves it. Custom code (creative mode) runs only after the
 * user presses "Run in sandbox", and only code that ran can be added.
 */
import * as React from "react"
import { CheckIcon, CodeIcon, LayoutGridIcon, PlayIcon, PlusIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"
import { type CustomWidget, widgetJson, type WidgetInput } from "@tomoe/core"

import { SandboxFrame } from "@/components/sandbox-frame"
import { Badge, Button, cn, DoneCheck, TomoeMark } from "@/components/ui"
import { WidgetView } from "@/components/widget-view"
import { useWorkspace } from "@/lib/workspace"

export function WidgetBody({ widget }: { widget: WidgetInput }) {
  return widget.kind === "custom" ? <SandboxFrame key={widgetJson(widget)} widget={widget} /> : <WidgetView spec={widget.spec} />
}

/** The creative-mode mark: agent code, always recognisable. */
export function CreativeBadge() {
  return (
    <Badge tone="accent" title="Code written by the agent, running in the sandbox">
      <TomoeMark className="size-3" accent />
      Creative
    </Badge>
  )
}

export function Proposal({ widget }: { widget: WidgetInput }) {
  const { board, save, setView } = useWorkspace()
  const [showing, setShowing] = React.useState<"proposed" | "current">("proposed")
  const [saving, setSaving] = React.useState(false)
  const [approved, setApproved] = React.useState(false)
  const [justSaved, setJustSaved] = React.useState(false)
  const current = board?.widgets.find((w) => w.id === widget.id) ?? null
  const saved = current !== null && widgetJson(current) === widgetJson(widget)
  const custom = widget.kind === "custom"
  const runs = !custom || saved || approved
  const shown = showing === "current" && current && !saved ? current : widget

  return (
    <div className={cn("animate-rise overflow-hidden rounded-xl border bg-card shadow-soft transition-[border-color,box-shadow] duration-300 hover:border-foreground/30", justSaved && "animate-[saved-glow_1.2s_ease-out_both]")}>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border", custom ? "border-foreground/40 bg-accent/30" : "border-foreground/20")}>
          {custom ? <TomoeMark className="size-4 text-foreground" accent /> : <LayoutGridIcon className="size-3.5" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="label-caps text-[9.5px]!">{current && !saved ? "Proposed change" : "Proposal"}</span>
          <span className="truncate font-display text-[14px] font-medium tracking-tight">{widget.title}</span>
        </span>
        {custom && <CreativeBadge />}
        <Badge tone="outline" className="font-mono tracking-normal uppercase">{widget.size}</Badge>
        {!saved && (
          <Badge key={current ? "c" : "n"} tone={current ? "accent" : "primary"} className="animate-pop">
            {current ? "Changed" : "New"}
          </Badge>
        )}
      </div>
      {current && !saved && runs && (
        <div className="relative flex border-b px-2" role="tablist" aria-label="Compare">
          <span className={cn("absolute bottom-0 h-[1.5px] w-[calc(50%-0.5rem)] bg-foreground transition-transform duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)]", showing === "current" && "translate-x-full")} aria-hidden />
          {(["proposed", "current"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={showing === v}
              onClick={() => setShowing(v)}
              className={cn("label-caps flex-1 cursor-pointer py-2.5 transition-colors", showing === v ? "text-foreground!" : "hover:text-foreground!")}
            >
              {v === "proposed" ? "Proposed" : "On the board"}
            </button>
          ))}
        </div>
      )}
      <div className="p-4">
        {runs ? (
          <div key={showing} className="animate-fade">
            <WidgetBody widget={shown} />
          </div>
        ) : (
          <RunGate widget={widget as CustomWidget} onRun={() => setApproved(true)} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        {saved ? (
          <span className="flex h-8 items-center gap-2 rounded-full border border-foreground/20 px-3 text-[13px] font-medium" aria-live="polite">
            {justSaved ? <DoneCheck className="size-4" /> : <CheckIcon className="size-4" />}
            On the board
          </span>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={saving || !board || !runs}
            onClick={async () => {
              setSaving(true)
              if (await save(widget)) {
                setShowing("proposed")
                setJustSaved(true)
              }
              setSaving(false)
            }}
            className={cn("group", saving && "animate-pulse")}
          >
            {saving ? <TomoeMark working className="size-4" /> : current ? <RefreshCwIcon className="transition-transform duration-500 group-hover:rotate-180" /> : <PlusIcon />}
            {saving ? (current ? "Updating…" : "Adding…") : current ? "Update on the board" : "Add to the board"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setView("board")} className="text-muted-foreground! hover:text-foreground!">
          Show board
        </Button>
      </div>
    </div>
  )
}

/** Custom code waiting for the user's yes: what it reads, its size, the code itself, the button that runs it. */
function RunGate({ widget, onRun }: { widget: CustomWidget; onRun: () => void }) {
  const { tomoe } = useWorkspace()
  const [code, setCode] = React.useState(false)
  const sources = [...new Set(Object.values(widget.data).map((q) => tomoe?.manifest.sources.find((s) => s.id === q.from)?.label ?? q.from))]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <ShieldCheckIcon className="mt-0.5 size-5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">This widget is code the agent wrote</p>
          <p className="text-[13px] text-muted-foreground">It runs in a sealed sandbox: no network, no storage, no access to this page. It only gets the rows it asks for, with sensitive fields hidden in privacy mode.</p>
          <p className="text-xs">
            <span className="text-muted-foreground">Reads: </span>
            {sources.join(", ") || "no data"}
            <span className="text-muted-foreground"> · {Math.max(1, Math.round(widget.code.length / 1024))} KB of code</span>
          </p>
        </div>
      </div>
      {code && <pre className="max-h-72 animate-rise overflow-auto rounded-lg border bg-background p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">{widget.code}</pre>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onRun}>
          <PlayIcon />
          Run in sandbox
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCode((v) => !v)}>
          <CodeIcon />
          {code ? "Hide code" : "Read the code"}
        </Button>
      </div>
    </div>
  )
}
