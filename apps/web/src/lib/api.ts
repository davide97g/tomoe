/** The Tomoe server's API, as the web client uses it. */
import type { Board, Manifest, Row } from "@tomoe/core"

export type Connection = { repo?: string; website?: string; url?: string; openapi?: string; headers: Record<string, string>; files?: string[] }
export type Finding = { kind: string; url: string; ok: boolean; note: string }
export type Recon = {
  origin: string
  findings: Finding[]
  suggested: { api?: string; openapi?: string; website?: string; name?: string; description?: string; mcp?: string; graphql?: string }
  manifest?: { sources: string[] }
  manifestProblem?: string
}
export type Status = { claude: boolean; today: string; skill: { repo: string; name: string } }
export type AppRecord = { id: string; name: string; kind: "playground" | "example" | "connected"; created: string; connection: Connection }
export type Draft = { manifest: unknown; problems: string[]; created: string }
export type HistoryItem = { label: string; at: string }
export type AppDetail = { app: AppRecord; manifest: Manifest; draft: Draft | null; history: HistoryItem[] }
export type ChatFile = { path: string; name: string; image: boolean; size: number; type: string }
export type ChatMessage = { role: "user" | "assistant"; text: string; tools: { name: string; detail: string }[]; files?: ChatFile[]; error?: string }
export type Chat = { id: string; title: string; session: string | null; created: string; updated: string; about?: string; messages: ChatMessage[] }
export type ChatSummary = { id: string; title: string; updated: string }

export type StreamEvent =
  | { type: "chat"; id: string }
  | { type: "session"; id: string }
  | { type: "block" }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "final"; text: string }
  | { type: "status"; text: string }
  | { type: "manifest"; draft: Manifest; problems: string[] }
  | { type: "recon"; findings: Finding[]; suggested: Recon["suggested"] }
  | { type: "end" }
  | { type: "error"; message: string }

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const r = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${r.status}`)
  return body as T
}

const app = (id: string) => `/api/apps/${encodeURIComponent(id)}`

export const api = {
  status: () => call<Status>("/api/status"),
  recon: (url: string) => call<Recon>("/api/recon", { method: "POST", json: { url } }),
  apps: () => call<AppRecord[]>("/api/apps"),
  app: (id: string) => call<AppDetail>(app(id)),
  createApp: (name: string, connection: Connection) => call<AppRecord>("/api/apps", { method: "POST", json: { name, connection } }),
  createExample: () => call<AppRecord>("/api/apps/example", { method: "POST" }),
  updateApp: (id: string, patch: { name?: string; connection?: Partial<Connection> }) => call<AppRecord>(app(id), { method: "PATCH", json: patch }),
  deleteApp: (id: string) => call<{ ok: boolean }>(app(id), { method: "DELETE" }),
  acceptManifest: (id: string, manifest: unknown) => call<{ manifest: Manifest }>(`${app(id)}/manifest`, { method: "POST", json: { manifest } }),
  discardDraft: (id: string) => call<{ ok: boolean }>(`${app(id)}/draft`, { method: "DELETE" }),
  dataFile: (id: string, path: string) => call<{ draft: Manifest; source: string }>(`${app(id)}/datafile`, { method: "POST", json: { path } }),
  rows: (id: string, source: string, fresh = false) => call<{ rows: Row[] | null; error: string | null }>(`${app(id)}/rows?source=${encodeURIComponent(source)}${fresh ? "&fresh=1" : ""}`),
  board: (id: string) => call<{ board: Board; history: HistoryItem[] }>(`${app(id)}/board`),
  saveWidget: (id: string, widget: { id: string }) => call<{ board: Board; added: boolean }>(`${app(id)}/board/widgets/${encodeURIComponent(widget.id)}`, { method: "PUT", json: widget }),
  removeWidget: (id: string, widget: string) => call<{ board: Board }>(`${app(id)}/board/widgets/${encodeURIComponent(widget)}`, { method: "DELETE" }),
  moveWidget: (id: string, widget: string, index: number) => call<{ board: Board }>(`${app(id)}/board/widgets/${encodeURIComponent(widget)}/move`, { method: "POST", json: { index } }),
  undo: (id: string) => call<{ board: Board; undone: string }>(`${app(id)}/board/undo`, { method: "POST" }),
  chats: (id: string) => call<ChatSummary[]>(`${app(id)}/chats`),
  chat: (id: string, chat: string) => call<Chat>(`${app(id)}/chats/${chat}`),
  deleteChat: (id: string, chat: string) => call<{ ok: boolean }>(`${app(id)}/chats/${chat}`, { method: "DELETE" }),
  upload: (id: string, files: File[]) => {
    const form = new FormData()
    files.forEach((f, i) => form.append(`file${i}`, f, f.name))
    return call<ChatFile[]>(`${app(id)}/files`, { method: "POST", body: form })
  },
  fileUrl: (id: string, path: string) => `${app(id)}/files?path=${encodeURIComponent(path)}`,
}

/** POST a JSON body and read the NDJSON stream of events. */
export async function stream(path: string, body: unknown, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
  if (!r.ok || !r.body) {
    const err = await r.json().catch(() => null)
    throw new Error((err as { error?: string } | null)?.error ?? `HTTP ${r.status}`)
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let rest = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    rest += value
    const lines = rest.split("\n")
    rest = lines.pop() ?? ""
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line))
  }
  if (rest.trim()) onEvent(JSON.parse(rest))
}

export const chatPath = (id: string) => `${app(id)}/chat`
export const discoverPath = (id: string, agent = false) => `${app(id)}/discover${agent ? "?agent=1" : ""}`
