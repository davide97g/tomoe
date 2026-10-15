/**
 * A widget the agent proposes: a live preview on the real data, the version on the board to compare with
 * when it is an update, and the button that saves it. Custom code (creative mode) runs only after the
 * user presses "Run in sandbox", and only code that ran can be added.
 */
import * as React from "react"
import { CheckIcon, CodeIcon, LayoutGridIcon, PlayIcon, PlusIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"
import { type CustomWidget, widgetJson, type WidgetInput } from "@tomoe/core"

import { SandboxFrame } from "@/components/sandbox-frame"
import { Badge, Button, cn, TomoeMark } from "@/components/ui"
import { WidgetView } from "@/components/widget-view"
import { useWorkspace } from "@/lib/workspace"

export function WidgetBody({ widget }: { widget: WidgetInput }) {
  return widget.kind === "custom" ? <SandboxFrame key={widgetJson(widget)} widget={widget} /> : <WidgetView spec={widget.spec} />
}

/** The creative-mode mark: agent code, always recognisable. */
export function CreativeBadge() {
  return (
    <Badge tone="kihada" title="Code written by the agent, running in the sandbox">
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
  const current = board?.widgets.find((w) => w.id === widget.id) ?? null
  const saved = current !== null && widgetJson(current) === widgetJson(widget)
  const custom = widget.kind === "custom"
  const runs = !custom || saved || approved
  const shown = showing === "current" && current && !saved ? current : widget

  return (
    <div className="animate-rise overflow-hidden rounded-xl border bg-card shadow-soft">
      <div className="flex items-center gap-2.5 border-b px-3.5 py-2.5">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", custom ? "bg-kihada/25" : "bg-primary/10 text-primary")}>
          {custom ? <TomoeMark className="size-4 text-primary" accent /> : <LayoutGridIcon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-[15px] font-bold">{widget.title}</span>
        {custom && <CreativeBadge />}
        <Badge tone="outline">{widget.size}</Badge>
        {!saved && <Badge tone={current ? "kihada" : "primary"}>{current ? "Changed" : "New"}</Badge>}
      </div>
      {current && !saved && runs && (
        <div className="flex gap-1 border-b bg-muted/40 p-1.5" role="tablist" aria-label="Compare">
          {(["proposed", "current"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={showing === v}
              onClick={() => setShowing(v)}
              className={cn("flex-1 cursor-pointer rounded-md py-1 text-xs font-medium capitalize transition-colors", showing === v ? "bg-card shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {v === "proposed" ? "Proposed" : "On the board"}
            </button>
          ))}
        </div>
      )}
      <div className="p-4">{runs ? <WidgetBody key={showing} widget={shown} /> : <RunGate widget={widget as CustomWidget} onRun={() => setApproved(true)} />}</div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3.5 py-2.5">
        {saved ? (
          <Button size="sm" variant="secondary" disabled>
            <CheckIcon />
            On the board
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={saving || !board || !runs}
            onClick={async () => {
              setSaving(true)
              if (await save(widget)) setShowing("proposed")
              setSaving(false)
            }}
          >
            {saving ? <TomoeMark working className="size-4" /> : current ? <RefreshCwIcon /> : <PlusIcon />}
            {current ? "Update on the board" : "Add to the board"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setView("board")}>
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
        <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
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
      {code && <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">{widget.code}</pre>}
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
