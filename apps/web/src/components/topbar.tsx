import * as React from "react"
import { flushSync } from "react-dom"
import { BoxIcon, CheckIcon, SettingsIcon, ChevronsUpDownIcon, DatabaseIcon, EyeIcon, EyeOffIcon, FolderGit2Icon, LayoutGridIcon, ListTreeIcon, MessageCircleIcon, MoonIcon, PlusIcon, SunIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button, cn, Kbd, TomoeMark } from "@/components/ui"
import { api, type AppRecord } from "@/lib/api"
import { useMascotMood } from "@/lib/mascot"
import { type View, useWorkspace } from "@/lib/workspace"

const KIND_ICON = { playground: BoxIcon, example: DatabaseIcon, connected: FolderGit2Icon }

export function Topbar() {
  const { view, setView, board, privacy, setPrivacy, dark, setDark } = useWorkspace()
  const working = useMascotMood() === "think"
  const count = board?.widgets.length ?? 0

  // The new theme spreads from the toggle as a circle, where the browser can (View Transitions).
  const toggleTheme = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = !dark
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return setDark(next)
    const r = e.currentTarget.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    const t = document.startViewTransition(() => flushSync(() => setDark(next)))
    void t.ready.then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 640, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", pseudoElement: "::view-transition-new(root)" }
      )
    )
  }

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-transparent px-3 sm:px-5">
      <div className="group/brand flex items-center gap-2.5 pr-1">
        <TomoeMark working={working} className="tomoe-turn size-5 text-foreground group-hover/brand:rotate-[120deg]" accent={working} />
        <span className="hidden items-baseline gap-2 sm:flex">
          <span className="font-display text-[13px] font-medium tracking-[0.32em]">TOMOE</span>
          <span className="font-jp text-[13px] text-muted-foreground">巴</span>
        </span>
      </div>
      <span className="mx-1 h-5 w-px bg-border" />
      <AppSwitcher />
      <div className="flex-1" />
      <ViewTabs view={view} setView={setView} count={count} />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setView(view === "settings" ? "focus" : "settings")}
        aria-pressed={view === "settings"}
        aria-label="Settings"
        title="Settings (,): test, recheck and reconfigure connected apps"
        className={cn("[&_svg]:transition-transform [&_svg]:duration-700 hover:[&_svg]:rotate-90", view === "settings" && "bg-foreground! text-background! [&_svg]:rotate-180")}
      >
        <SettingsIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setPrivacy(!privacy)}
        aria-pressed={privacy}
        aria-label="Privacy mode"
        title="Privacy mode (P): hide sensitive values"
        className={cn(privacy && "bg-foreground! text-background! hover:bg-foreground/85!")}
      >
        <span key={String(privacy)} className="inline-flex animate-pop">
          {privacy ? <EyeOffIcon /> : <EyeIcon />}
        </span>
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label={dark ? "Light theme" : "Dark theme"} title={dark ? "Light theme" : "Dark theme"}>
        <span key={String(dark)} className="inline-flex animate-[pop_420ms_cubic-bezier(0.34,1.56,0.64,1)_both] [&_svg]:transition-transform">
          {dark ? <SunIcon className="animate-[spin_700ms_cubic-bezier(0.2,0.8,0.2,1)_1]" /> : <MoonIcon />}
        </span>
      </Button>
    </header>
  )
}

/** Chat and Board, with an ink pill that slides to the active one. */
function ViewTabs({ view, setView, count }: { view: View; setView: (v: View) => void; count: number }) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({})
  const [pill, setPill] = React.useState<{ left: number; width: number } | null>(null)
  React.useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[view]
      setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
    }
    measure()
    const o = new ResizeObserver(measure)
    Object.values(refs.current).forEach((el) => el && o.observe(el))
    return () => o.disconnect()
  }, [view, count])
  const tabs = [
    { id: "focus" as const, icon: <MessageCircleIcon />, label: "Chat" },
    { id: "board" as const, icon: <LayoutGridIcon />, label: "Board", count },
  ]
  return (
    <div className="relative flex rounded-full border border-foreground/15 p-0.5" role="tablist" aria-label="Layout">
      {pill && <span className="absolute top-0.5 bottom-0.5 rounded-full bg-foreground transition-[left,width] duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)]" style={{ left: pill.left, width: pill.width }} aria-hidden />}
      {tabs.map((t) => {
        const active = view === t.id
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setView(t.id)}
            className={cn(
              "relative z-10 flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-300 active:scale-95 [&_svg]:size-3.5",
              active ? "text-background" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span key={t.count} className={cn("min-w-4 animate-pop rounded-full px-1 text-center font-mono text-[10px] tabular-nums", active ? "bg-background/20" : "bg-foreground/10")}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function AppSwitcher() {
  const { apps, app, selectApp, setDialog, reloadApps, detail, tomoe, setView } = useWorkspace()
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 cursor-pointer items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors hover:bg-muted active:scale-[0.98]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{app?.name ?? "…"}</span>
        <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">{sources ? `${sources} ${sources === 1 ? "source" : "sources"}` : "no data"}</span>
        {detail?.draft && <span className="size-1.5 animate-pulse rounded-full bg-foreground" title="A manifest waits for review" />}
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-40 mt-1.5 w-72 origin-top-left animate-[dialog-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-xl border bg-card p-1 shadow-soft" role="menu">
            <p className="label-caps px-2.5 pt-2.5 pb-2">Apps</p>
            <div className="stagger">
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
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-[background-color,padding] duration-200 hover:bg-muted hover:pl-3.5"
                    >
                      <I className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{a.name}</span>
                      {a.id === app?.id && <CheckIcon className="ml-auto size-3.5 shrink-0" />}
                    </button>
                    {a.kind !== "playground" && (
                      <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Remove ${a.name}`} onClick={() => void remove(a)}>
                        <Trash2Icon className="size-3.5!" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="my-1 h-px bg-border" />
            <MenuButton icon={<ListTreeIcon />} label={detail?.draft ? "Review the draft sources" : "Sources of this app"} onClick={() => (setOpen(false), setDialog({ kind: "review" }))} />
            <MenuButton icon={<PlusIcon />} label="Connect an app…" onClick={() => (setOpen(false), setDialog({ kind: "connect" }))} />
            <MenuButton icon={<SettingsIcon />} label="Settings: test, recheck, reconfigure" onClick={() => (setOpen(false), setView("settings"))} />
            <p className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-2 text-[11px] text-muted-foreground">
              <Kbd>B</Kbd> board <span className="text-border">/</span> <Kbd>P</Kbd> privacy <span className="text-border">/</span> <Kbd>,</Kbd> settings <span className="text-border">/</span> <Kbd>Esc</Kbd> stop
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function MenuButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-[background-color,padding] duration-200 hover:bg-muted hover:pl-3.5 [&_svg]:size-4 [&_svg]:text-muted-foreground"
    >
      {icon}
      {label}
    </button>
  )
}
