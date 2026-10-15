/**
 * The board: the widgets the user added, in order, each drawn live from its queries. Every change is
 * one revision on the server, so Undo always works.
 */
import * as React from "react"
import { ArrowLeftIcon, ArrowRightIcon, EllipsisIcon, MessageSquareTextIcon, RefreshCwIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import type { Widget } from "@tomoe/core"

import { CreativeBadge, WidgetBody } from "@/components/proposal"
import { Button, cn, TomoeMark } from "@/components/ui"
import { useWorkspace } from "@/lib/workspace"

const SPAN = { small: "@3xl:col-span-1", medium: "@3xl:col-span-2", large: "@3xl:col-span-2 @6xl:col-span-3", full: "@3xl:col-span-2 @6xl:col-span-4" } as const

export function BoardView() {
  const { board, history, undo, refresh, app, tomoe, setView } = useWorkspace()
  if (!board) return <div className="m-6 h-40 animate-pulse rounded-2xl bg-muted" />
  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Board</p>
            <h2 className="truncate font-display text-2xl font-bold tracking-tight">{app?.name}</h2>
          </div>
          {tomoe && tomoe.manifest.sources.length > 0 && (
            <Button size="sm" variant="ghost" onClick={refresh} title="Fetch the data again">
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
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-20 text-center">
            <TomoeMark className="size-10 text-primary/70" accent />
            <p className="font-display text-xl font-bold">The board is empty</p>
            <p className="max-w-sm text-sm text-muted-foreground">Ask the chat for a widget, then press “Add to the board” on the preview you like.</p>
            <Button variant="primary" size="sm" onClick={() => setView("focus")}>
              Open the chat
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-4">
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
    <article className={cn("group relative flex min-w-0 animate-rise flex-col rounded-2xl border bg-card shadow-soft", SPAN[widget.size])}>
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <h3 className="min-w-0 flex-1 truncate font-display text-[15px] font-bold">{widget.title}</h3>
        {widget.kind === "custom" && <CreativeBadge />}
        <div className="relative">
          <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Options for ${widget.title}`} onClick={() => setMenu((v) => !v)}>
            <EllipsisIcon />
          </Button>
          {menu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
              <div className="absolute top-full right-0 z-40 mt-1 w-52 animate-rise rounded-xl border bg-card p-1 shadow-soft">
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
      <div className="min-w-0 px-4 pt-1 pb-4">
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
      className={cn("flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4", danger && "text-negative")}
    >
      {icon}
      {label}
    </button>
  )
}
