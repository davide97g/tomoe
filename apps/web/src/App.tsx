/**
 * One chat, always mounted: full screen at first; beside the board once the user opens it, so an
 * answer keeps streaming while the layout changes.
 */
import * as React from "react"
import { Toaster } from "sonner"

import { BoardView } from "@/components/board"
import { Chat } from "@/components/chat"
import { Dialogs } from "@/components/connect"
import { SettingsView } from "@/components/settings"
import { Topbar } from "@/components/topbar"
import { cn } from "@/components/ui"
import { MascotProvider } from "@/lib/mascot"
import { useWorkspace, WorkspaceProvider } from "@/lib/workspace"

function useWide() {
  const query = "(min-width: 1024px)"
  const [wide, setWide] = React.useState(() => matchMedia(query).matches)
  React.useEffect(() => {
    const m = matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [])
  return wide
}

function Layout() {
  const { view, setView, privacy, setPrivacy, dark, dialog } = useWorkspace()
  const wide = useWide()
  const settings = view === "settings"
  // What lies under Settings: the layout the user left, kept mounted so an answer keeps streaming.
  const under = React.useRef<"focus" | "board">("focus")
  if (view !== "settings") under.current = view
  const board = (settings ? under.current : view) === "board"
  const closeSettings = React.useCallback(() => setView(under.current), [setView])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (dialog || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return
      if (e.key === "b" || e.key === "B") setView(board && !settings ? "focus" : "board")
      else if (e.key === "p" || e.key === "P") setPrivacy(!privacy)
      else if (e.key === ",") setView(settings ? under.current : "settings")
      else if (e.key === "Escape" && settings) closeSettings()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [board, settings, setView, privacy, setPrivacy, dialog, closeSettings])

  const columns = board ? (wide ? "minmax(0,1fr) minmax(360px,min(440px,36vw))" : "minmax(0,1fr) 0px") : "0px minmax(0,1fr)"
  return (
    <div className="paper flex h-full flex-col bg-background">
      <Topbar />
      <div className="relative min-h-0 flex-1">
      <main inert={settings} aria-hidden={settings || undefined} className={cn("absolute inset-0 grid transition-[grid-template-columns,opacity,transform,filter] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]", settings && "pointer-events-none scale-[0.985] opacity-0 blur-[2px]")} style={{ gridTemplateColumns: columns }}>
        <section className={cn("min-w-0 overflow-hidden", !board && "invisible")} aria-hidden={!board}>
          <BoardView />
        </section>
        <aside className={cn("min-h-0 min-w-0 overflow-hidden", board && "border-l bg-card/50", board && !wide && "invisible")}>
          <Chat mode={board ? "panel" : "focus"} />
        </aside>
      </main>
        {settings && (
          <section className="absolute inset-0 z-10 animate-[settings-in_520ms_cubic-bezier(0.2,0.8,0.2,1)_both]" aria-label="Settings">
            <SettingsView onClose={closeSettings} />
          </section>
        )}
      </div>
      <Dialogs />
      <Toaster theme={dark ? "dark" : "light"} position="top-center" offset={68} gap={10} toastOptions={{ duration: 4200 }} />
    </div>
  )
}

export function App() {
  return (
    <MascotProvider>
      <WorkspaceProvider>
        <Layout />
      </WorkspaceProvider>
    </MascotProvider>
  )
}
