/**
 * One chat, always mounted: full screen at first; beside the board once the user opens it, so an
 * answer keeps streaming while the layout changes.
 */
import * as React from "react"
import { Toaster } from "sonner"

import { BoardView } from "@/components/board"
import { Chat } from "@/components/chat"
import { Dialogs } from "@/components/connect"
import { Topbar } from "@/components/topbar"
import { cn } from "@/components/ui"
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
  const board = view === "board"

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (dialog || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return
      if (e.key === "b" || e.key === "B") setView(board ? "focus" : "board")
      else if (e.key === "p" || e.key === "P") setPrivacy(!privacy)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [board, setView, privacy, setPrivacy, dialog])

  const columns = board ? (wide ? "minmax(0,1fr) minmax(360px,min(440px,36vw))" : "minmax(0,1fr) 0px") : "0px minmax(0,1fr)"
  return (
    <div className="flex h-full flex-col bg-background">
      <Topbar />
      <main className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]" style={{ gridTemplateColumns: columns }}>
        <section className={cn("min-w-0 overflow-hidden", !board && "invisible")} aria-hidden={!board}>
          <BoardView />
        </section>
        <aside className={cn("min-h-0 min-w-0 overflow-hidden", board && "border-l bg-card/40", board && !wide && "invisible")}>
          <Chat mode={board ? "panel" : "focus"} />
        </aside>
      </main>
      <Dialogs />
      <Toaster theme={dark ? "dark" : "light"} position="bottom-center" toastOptions={{ style: { background: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" } }} />
    </div>
  )
}

export function App() {
  return (
    <WorkspaceProvider>
      <Layout />
    </WorkspaceProvider>
  )
}
