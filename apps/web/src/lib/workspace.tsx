/**
 * The app the user is working on, shared by the chat, the board and the dialogs: its manifest and the
 * Tomoe built from it (every schema), the rows of the sources the visible widgets read, the board with
 * Undo, and the view preferences (privacy, theme, layout).
 */
import * as React from "react"
import { actionPath, type Board, type Context, createTomoe, type Row, type Tomoe, type WidgetInput } from "@tomoe/core"
import { toast } from "sonner"

import { type AppDetail, type AppRecord, api, type HistoryItem } from "@/lib/api"

type Rows = Record<string, { rows: Row[] | null; error: string | null; at: number } | undefined>
export type View = "focus" | "board"
export type Dialog = null | { kind: "connect"; url?: string } | { kind: "review" } | { kind: "discover" } | { kind: "skill" }
export type ChatRequest = { about?: string; text?: string; nonce: number }

type Workspace = {
  ready: boolean
  claude: boolean
  /** Where the tomoe-ready skill is published. */
  skillRepo: string
  apps: AppRecord[]
  app: AppRecord | null
  detail: AppDetail | null
  tomoe: Tomoe | null
  selectApp: (id: string) => void
  reloadApps: (select?: string) => Promise<void>
  reloadDetail: () => Promise<void>
  /** Rows for evaluating queries; `pending` lists the sources still loading. */
  context: Context | null
  rowsError: (source: string) => string | null
  need: (sources: string[]) => void
  pending: (sources: string[]) => boolean
  refresh: () => void
  board: Board | null
  history: HistoryItem[]
  save: (w: WidgetInput) => Promise<boolean>
  remove: (id: string) => Promise<void>
  move: (id: string, index: number) => Promise<void>
  undo: () => Promise<void>
  privacy: boolean
  setPrivacy: (v: boolean) => void
  dark: boolean
  setDark: (v: boolean) => void
  view: View
  setView: (v: View) => void
  dialog: Dialog
  setDialog: (d: Dialog) => void
  chatRequest: ChatRequest | null
  askChat: (r: Omit<ChatRequest, "nonce">) => void
  /** Opens a manifest action: the path is built here from validated params, never by a widget. */
  open: (action: string, params?: Record<string, string>) => void
}

const Ctx = React.createContext<Workspace | null>(null)

const stored = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode: nothing remembered
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false)
  const [claude, setClaude] = React.useState(true)
  const [skillRepo, setSkillRepo] = React.useState("davide97g/tomoe")
  const [today, setToday] = React.useState(() => new Date().toLocaleDateString("en-CA"))
  const [apps, setApps] = React.useState<AppRecord[]>([])
  const [appId, setAppId] = React.useState<string>(() => stored("tomoe:app") ?? "playground")
  const [detail, setDetail] = React.useState<AppDetail | null>(null)
  const [rows, setRows] = React.useState<Rows>({})
  const [board, setBoard] = React.useState<Board | null>(null)
  const [history, setHistory] = React.useState<HistoryItem[]>([])
  const [privacy, setPrivacyState] = React.useState(() => stored("tomoe:privacy") === "1")
  const [dark, setDarkState] = React.useState(() => document.documentElement.classList.contains("dark"))
  const [view, setView] = React.useState<View>("focus")
  const [dialog, setDialog] = React.useState<Dialog>(null)
  const [chatRequest, setChatRequest] = React.useState<ChatRequest | null>(null)
  const wanted = React.useRef(new Set<string>())
  const inflight = React.useRef(new Set<string>())

  const reloadApps = React.useCallback(async (select?: string) => {
    const list = await api.apps()
    setApps(list)
    setAppId((cur) => {
      const next = select ?? (list.some((a) => a.id === cur) ? cur : "playground")
      store("tomoe:app", next)
      return next
    })
  }, [])

  React.useEffect(() => {
    api.status().then((s) => {
      setClaude(s.claude)
      setToday(s.today)
      setSkillRepo(s.skill.repo)
    }, () => setClaude(false))
    reloadApps().catch((e: Error) => toast.error(e.message))
  }, [reloadApps])

  const reloadDetail = React.useCallback(async () => {
    const [d, b] = await Promise.all([api.app(appId), api.board(appId)])
    setDetail(d)
    setBoard(b.board)
    setHistory(b.history)
    setReady(true)
  }, [appId])

  React.useEffect(() => {
    setDetail(null)
    setBoard(null)
    setRows({})
    wanted.current.clear()
    reloadDetail().catch((e: Error) => {
      toast.error(e.message)
      setAppId("playground")
    })
  }, [reloadDetail])

  const manifestKey = detail ? JSON.stringify(detail.manifest) : ""
  const tomoe = React.useMemo(() => {
    if (!detail) return null
    try {
      return createTomoe(detail.manifest)
    } catch (e) {
      toast.error((e as Error).message)
      return null
    }
  }, [manifestKey])

  // A new manifest: rows are fetched again.
  React.useEffect(() => {
    setRows({})
  }, [manifestKey])

  const fetchSource = React.useCallback(
    (source: string, fresh = false) => {
      if (inflight.current.has(source)) return
      inflight.current.add(source)
      api
        .rows(appId, source, fresh)
        .then(
          (r) => setRows((prev) => ({ ...prev, [source]: { rows: r.rows, error: r.error, at: Date.now() } })),
          (e: Error) => setRows((prev) => ({ ...prev, [source]: { rows: null, error: e.message, at: Date.now() } }))
        )
        .finally(() => inflight.current.delete(source))
    },
    [appId]
  )

  const need = React.useCallback(
    (sources: string[]) => {
      for (const s of sources) {
        if (!tomoe?.manifest.sources.some((x) => x.id === s)) continue
        wanted.current.add(s)
        if (!rows[s]) fetchSource(s)
      }
    },
    [fetchSource, rows, tomoe]
  )

  const refresh = React.useCallback(() => {
    for (const s of wanted.current) fetchSource(s, true)
  }, [fetchSource])

  // Live data: poll at the manifest's pace.
  React.useEffect(() => {
    const r = tomoe?.manifest.refresh
    const seconds = r?.kind === "poll" ? r.seconds : 60
    const t = setInterval(() => {
      if (document.visibilityState === "visible") for (const s of wanted.current) fetchSource(s)
    }, seconds * 1000)
    return () => clearInterval(t)
  }, [tomoe, fetchSource])

  const context = React.useMemo<Context | null>(
    () => (tomoe ? { manifest: tomoe.manifest, today, rows: (s) => rows[s]?.rows ?? null } : null),
    [tomoe, rows, today]
  )

  const pending = React.useCallback((sources: string[]) => sources.some((s) => tomoe?.manifest.sources.some((x) => x.id === s) && !rows[s]), [rows, tomoe])
  const rowsError = React.useCallback((s: string) => rows[s]?.error ?? null, [rows])

  const save = React.useCallback(
    async (w: WidgetInput) => {
      try {
        const r = await api.saveWidget(appId, w)
        setBoard(r.board)
        setHistory((h) => [{ label: `${r.added ? "Add" : "Update"} ${w.title}`, at: new Date().toISOString() }, ...h])
        toast.success(r.added ? `Added “${w.title}” to the board` : `Updated “${w.title}”`, { action: { label: "Show board", onClick: () => setView("board") } })
        return true
      } catch (e) {
        toast.error((e as Error).message)
        return false
      }
    },
    [appId]
  )

  const remove = React.useCallback(
    async (id: string) => {
      const title = board?.widgets.find((w) => w.id === id)?.title ?? id
      const r = await api.removeWidget(appId, id)
      setBoard(r.board)
      setHistory((h) => [{ label: `Remove ${id}`, at: new Date().toISOString() }, ...h])
      toast(`Removed “${title}”`, {
        action: {
          label: "Undo",
          onClick: () =>
            void api.undo(appId).then((u) => {
              setBoard(u.board)
              setHistory((h) => h.slice(1))
            }),
        },
      })
    },
    [appId, board]
  )

  const move = React.useCallback(
    async (id: string, index: number) => {
      const r = await api.moveWidget(appId, id, index)
      setBoard(r.board)
      setHistory((h) => [{ label: `Move ${id}`, at: new Date().toISOString() }, ...h])
    },
    [appId]
  )

  const undo = React.useCallback(async () => {
    try {
      const r = await api.undo(appId)
      setBoard(r.board)
      setHistory((h) => h.slice(1))
      toast(`Undone: ${r.undone}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [appId])

  const setPrivacy = React.useCallback((v: boolean) => {
    setPrivacyState(v)
    store("tomoe:privacy", v ? "1" : "0")
  }, [])

  const setDark = React.useCallback((v: boolean) => {
    setDarkState(v)
    document.documentElement.classList.toggle("dark", v)
    store("tomoe:theme", v ? "dark" : "light")
  }, [])

  const askChat = React.useCallback((r: Omit<ChatRequest, "nonce">) => setChatRequest({ ...r, nonce: Date.now() }), [])

  const app = apps.find((a) => a.id === appId) ?? detail?.app ?? null

  const open = React.useCallback(
    (action: string, params: Record<string, string> = {}) => {
      if (!tomoe) return
      const a = tomoe.manifest.actions.find((x) => x.id === action)
      if (!a) return
      const path = actionPath(tomoe.manifest, action, params)
      const base = app?.connection.website ?? app?.connection.url
      if (!path) return void toast.error(`“${a.label}” needs ${Object.keys(a.params).join(", ")}`)
      if (!base) return void toast(`${a.label}: ${path}`, { description: "Connect the app's URL to open its screens." })
      window.open(new URL(path, base).toString(), "_blank", "noopener,noreferrer")
    },
    [tomoe, app]
  )

  const value: Workspace = {
    ready,
    claude,
    skillRepo,
    apps,
    app,
    detail,
    tomoe,
    selectApp: (id) => {
      store("tomoe:app", id)
      setAppId(id)
    },
    reloadApps,
    reloadDetail,
    context,
    rowsError,
    need,
    pending,
    refresh,
    board,
    history,
    save,
    remove,
    move,
    undo,
    privacy,
    setPrivacy,
    dark,
    setDark,
    view,
    setView,
    dialog,
    setDialog,
    chatRequest,
    askChat,
    open,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): Workspace {
  const v = React.useContext(Ctx)
  if (!v) throw new Error("useWorkspace outside WorkspaceProvider")
  return v
}
