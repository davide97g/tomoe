/**
 * The board: the widgets the user added, in order, each drawn live from its queries. Every change is
 * one revision on the server, so Undo always works.
 */
import * as React from "react"
import { ArrowLeftIcon, ArrowRightIcon, EllipsisIcon, MessageSquareTextIcon, RefreshCwIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import type { Widget } from "@tomoe/core"

import { CreativeBadge, WidgetBody } from "@/components/proposal"
import { Mascot } from "@/components/mascot"
import { Button, cn, Label } from "@/components/ui"
import { useWorkspace } from "@/lib/workspace"

const SPAN = { small: "@3xl:col-span-1", medium: "@3xl:col-span-2", large: "@3xl:col-span-2 @6xl:col-span-3", full: "@3xl:col-span-2 @6xl:col-span-4" } as const

export function BoardView() {
  const { board, history, undo, refresh, app, tomoe, setView } = useWorkspace()
  if (!board)
    return (
      <div className="grid gap-4 p-6 sm:grid-cols-2">
        <div className="shimmer h-6 w-40 rounded-full sm:col-span-2" />
        <div className="shimmer h-48 rounded-2xl" />
        <div className="shimmer h-48 rounded-2xl" />
      </div>
    )
  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-8">
        <header className="flex flex-wrap items-end gap-3 border-b pb-5">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Label>Board</Label>
            <h2 className="truncate font-display text-[1.7rem] leading-none font-normal tracking-[-0.02em]">{app?.name}</h2>
          </div>
          <span className="hidden items-baseline gap-1.5 pr-3 sm:flex">
            <span key={board.widgets.length} className="animate-pop font-display text-sm">{board.widgets.length}</span>
            <span className="label-caps">{board.widgets.length === 1 ? "widget" : "widgets"}</span>
          </span>
          {tomoe && tomoe.manifest.sources.length > 0 && (
            <Button size="sm" variant="ghost" onClick={refresh} title="Fetch the data again" className="active:[&_svg]:rotate-180 [&_svg]:transition-transform [&_svg]:duration-500">
              <RefreshCwIcon />
              Refresh
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void undo()} disabled={!history.length} title={history[0] ? `Undo: ${history[0].label}` : "Nothing to undo"}>
            <Undo2Icon />
            Undo{history[0] ? <span className="hidden max-w-44 truncate text-muted-foreground sm:inline">· {history[0].label}</span> : null}
          </Button>
        </header>
        {board.widgets.length === 0 ? (
          <div className="flex animate-rise flex-col items-center gap-4 rounded-2xl border border-dashed border-foreground/25 px-6 py-20 text-center">
            <Mascot size={56} />
            <p className="font-display text-xl font-normal tracking-tight">The board is empty</p>
            <span className="rule-draw" />
            <p className="max-w-sm text-sm text-muted-foreground">Ask the chat for a widget, then press “Add to the board” on the preview you like.</p>
            <Button variant="primary" size="sm" onClick={() => setView("focus")}>
              Open the chat
            </Button>
          </div>
        ) : (
          <div className="stagger grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-4">
            {board.widgets.map((w, i) => (
              <WidgetCard key={w.id} widget={w} index={i} count={board.widgets.length} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function WidgetCard({ widget, index, count }: { widget: Widget; index: number; count: number }) {
  const { remove, move, askChat, setView, view } = useWorkspace()
  const [menu, setMenu] = React.useState(false)
  return (
    <article className={cn("group relative flex min-w-0 flex-col rounded-2xl border bg-card transition-[border-color,box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-soft", menu && "z-10", SPAN[widget.size])}>
      <header className="flex items-center gap-2 px-5 pt-4 pb-1">
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <h3 className="min-w-0 flex-1 truncate font-display text-[13.5px] font-medium tracking-tight">{widget.title}</h3>
        {widget.kind === "custom" && <CreativeBadge />}
        <div className="relative">
          <Button variant="ghost" size="icon-sm" className={cn("opacity-50 group-hover:opacity-100 focus-visible:opacity-100", menu && "bg-muted opacity-100!")} aria-label={`Options for ${widget.title}`} onClick={() => setMenu((v) => !v)}>
            <EllipsisIcon />
          </Button>
          {menu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
              <div className="stagger absolute top-full right-0 z-40 mt-1 w-52 origin-top-right animate-[dialog-in_280ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-xl border bg-card p-1 shadow-soft">
                <MenuItem
                  icon={<MessageSquareTextIcon />}
                  label="Ask for a change"
                  onClick={() => {
                    setMenu(false)
                    askChat({ about: `widget:${widget.id}`, text: "" })
                    if (view === "focus") setView("board")
                  }}
                />
                <MenuItem icon={<ArrowLeftIcon />} label="Move earlier" disabled={index === 0} onClick={() => void move(widget.id, index - 1).then(() => setMenu(false))} />
                <MenuItem icon={<ArrowRightIcon />} label="Move later" disabled={index === count - 1} onClick={() => void move(widget.id, index + 1).then(() => setMenu(false))} />
                <MenuItem icon={<Trash2Icon />} label="Remove" danger onClick={() => void remove(widget.id).then(() => setMenu(false))} />
              </div>
            </>
          )}
        </div>
      </header>
      <div className="min-w-0 px-5 pt-2 pb-5">
        <WidgetBody widget={widget} />
      </div>
    </article>
  )
}

function MenuItem({ icon, label, onClick, disabled, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-[background-color,padding] duration-200 hover:bg-muted hover:pl-3.5 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        danger && "text-negative hover:bg-negative/8 [&_svg]:text-negative"
      )}
    >
      {icon}
      {label}
    </button>
  )
}
