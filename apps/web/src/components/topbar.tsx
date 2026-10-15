import * as React from "react"
import { BoxIcon, CheckIcon, ChevronsUpDownIcon, DatabaseIcon, EyeIcon, EyeOffIcon, FolderGit2Icon, LayoutGridIcon, ListTreeIcon, MessageCircleIcon, MoonIcon, PlusIcon, SunIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button, cn, Kbd, TomoeMark } from "@/components/ui"
import { api, type AppRecord } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

const KIND_ICON = { playground: BoxIcon, example: DatabaseIcon, connected: FolderGit2Icon }

export function Topbar() {
  const { view, setView, board, privacy, setPrivacy, dark, setDark } = useWorkspace()
  const count = board?.widgets.length ?? 0
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
      <div className="flex items-center gap-2 pr-1">
        <TomoeMark className="size-6 text-primary" accent />
        <span className="hidden font-display text-lg font-bold tracking-tight sm:inline">Tomoe</span>
      </div>
      <span className="h-5 w-px bg-border" />
      <AppSwitcher />
      <div className="flex-1" />
      <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Layout">
        <ViewTab active={view === "focus"} onClick={() => setView("focus")} icon={<MessageCircleIcon />} label="Chat" />
        <ViewTab active={view === "board"} onClick={() => setView("board")} icon={<LayoutGridIcon />} label="Board" count={count} />
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => setPrivacy(!privacy)} aria-pressed={privacy} aria-label="Privacy mode" title="Privacy mode (P): hide sensitive values">
        {privacy ? <EyeOffIcon className="text-kihada" /> : <EyeIcon />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => setDark(!dark)} aria-label={dark ? "Light theme" : "Dark theme"}>
        {dark ? <SunIcon /> : <MoonIcon />}
      </Button>
    </header>
  )
}

function ViewTab({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-all [&_svg]:size-3.5", active ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {count !== undefined && count > 0 && <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-primary text-primary-foreground" : "bg-border")}>{count}</span>}
    </button>
  )
}

function AppSwitcher() {
  const { apps, app, selectApp, setDialog, reloadApps, detail, tomoe } = useWorkspace()
  const [open, setOpen] = React.useState(false)
  const Icon = app ? KIND_ICON[app.kind] : BoxIcon
  const sources = tomoe?.manifest.sources.length ?? 0

  const remove = async (a: AppRecord) => {
    if (!confirm(`Remove “${a.name}” from Tomoe? Its board and chats are deleted; the app itself is not touched.`)) return
    try {
      await api.deleteApp(a.id)
      await reloadApps(a.id === app?.id ? "playground" : undefined)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="relative min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted" aria-haspopup="menu" aria-expanded={open}>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{app?.name ?? "…"}</span>
        <span className="hidden text-xs text-muted-foreground md:inline">{sources ? `${sources} ${sources === 1 ? "source" : "sources"}` : "no data"}</span>
        {detail?.draft && <span className="size-1.5 rounded-full bg-kihada" title="A manifest waits for review" />}
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-40 mt-1 w-72 animate-rise rounded-xl border bg-card p-1 shadow-soft" role="menu">
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Apps</p>
            {apps.map((a) => {
              const I = KIND_ICON[a.kind]
              return (
                <div key={a.id} className="group flex items-center">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      selectApp(a.id)
                      setOpen(false)
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <I className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.name}</span>
                    {a.id === app?.id && <CheckIcon className="ml-auto size-3.5 shrink-0 text-primary" />}
                  </button>
                  {a.kind !== "playground" && (
                    <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Remove ${a.name}`} onClick={() => void remove(a)}>
                      <Trash2Icon className="size-3.5!" />
                    </Button>
                  )}
                </div>
              )
            })}
            <div className="my-1 h-px bg-border" />
            <MenuButton icon={<ListTreeIcon />} label={detail?.draft ? "Review the draft sources" : "Sources of this app"} onClick={() => (setOpen(false), setDialog({ kind: "review" }))} />
            <MenuButton icon={<PlusIcon />} label="Connect an app…" onClick={() => (setOpen(false), setDialog({ kind: "connect" }))} />
            <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-muted-foreground">
              <Kbd>B</Kbd> board · <Kbd>P</Kbd> privacy · <Kbd>Esc</Kbd> stop
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function MenuButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      {label}
    </button>
  )
}
