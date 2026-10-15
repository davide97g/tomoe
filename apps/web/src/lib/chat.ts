/** One conversation with the agent: messages, the live answer streamed from the server, history. */
import * as React from "react"

import { api, type ChatFile, type ChatMessage, type ChatSummary, chatPath, stream } from "@/lib/api"

export type LiveMessage = ChatMessage & { streaming?: boolean; status?: string }

const key = (app: string) => `tomoe:chat:${app}`
const remembered = (app: string) => {
  try {
    return localStorage.getItem(key(app))
  } catch {
    return null
  }
}
const remember = (app: string, id: string | null) => {
  try {
    if (id) localStorage.setItem(key(app), id)
    else localStorage.removeItem(key(app))
  } catch {
    // nothing remembered
  }
}

export function useChat(app: string) {
  const [chatId, setChatId] = React.useState<string | null>(null)
  const [about, setAbout] = React.useState<string | undefined>()
  const [messages, setMessages] = React.useState<LiveMessage[]>([])
  const [busy, setBusy] = React.useState(false)
  const [history, setHistory] = React.useState<ChatSummary[]>([])
  const abort = React.useRef<AbortController | null>(null)

  const loadHistory = React.useCallback(() => {
    api.chats(app).then(setHistory, () => setHistory([]))
  }, [app])

  const load = React.useCallback(
    async (id: string | null) => {
      abort.current?.abort()
      setBusy(false)
      setChatId(id)
      remember(app, id)
      if (!id) {
        setMessages([])
        setAbout(undefined)
        return
      }
      try {
        const c = await api.chat(app, id)
        setMessages(c.messages)
        setAbout(c.about)
      } catch {
        setMessages([])
        setChatId(null)
        remember(app, null)
      }
    },
    [app]
  )

  React.useEffect(() => {
    void load(remembered(app))
    loadHistory()
    return () => abort.current?.abort()
  }, [app, load, loadHistory])

  const update = (fn: (m: LiveMessage) => LiveMessage) => setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])])

  const send = React.useCallback(
    async (text: string, files: ChatFile[] = [], options: { about?: string } = {}) => {
      if (busy) return
      const subject = options.about ?? about
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      setMessages((ms) => [...ms, { role: "user", text, tools: [], files }, { role: "assistant", text: "", tools: [], streaming: true }])
      try {
        await stream(
          chatPath(app),
          { message: text, chat: chatId, files: files.map((f) => f.path), about: subject },
          (e) => {
            if (e.type === "chat") {
              setChatId(e.id)
              remember(app, e.id)
            } else if (e.type === "text") update((m) => ({ ...m, text: m.text + e.text, status: undefined }))
            else if (e.type === "block") update((m) => (m.text ? { ...m, text: `${m.text}\n\n` } : m))
            else if (e.type === "tool") update((m) => ({ ...m, tools: [...m.tools, { name: e.name, detail: e.detail }], status: undefined }))
            else if (e.type === "status") update((m) => ({ ...m, status: e.text }))
            else if (e.type === "final") update((m) => ({ ...m, text: e.text, status: undefined }))
            else if (e.type === "error") update((m) => ({ ...m, error: e.message }))
          },
          controller.signal
        )
      } catch (e) {
        if (!controller.signal.aborted) update((m) => ({ ...m, error: (e as Error).message }))
      } finally {
        update((m) => ({ ...m, streaming: false, status: undefined }))
        setBusy(false)
        if (subject) setAbout(subject)
        loadHistory()
      }
    },
    [app, about, busy, chatId, loadHistory]
  )

  const stop = React.useCallback(() => abort.current?.abort(), [])

  const fresh = React.useCallback(
    (subject?: string) => {
      void load(null)
      setAbout(subject)
    },
    [load]
  )

  const forget = React.useCallback(
    async (id: string) => {
      await api.deleteChat(app, id)
      if (id === chatId) void load(null)
      loadHistory()
    },
    [app, chatId, load, loadHistory]
  )

  return { chatId, about, messages, busy, history, send, stop, fresh, open: load, forget }
}
