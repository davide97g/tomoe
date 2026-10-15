/**
 * Everything Tomoe keeps, as files under the data folder, one folder per connected app:
 *
 *   apps/<id>/app.json        name and connection (repo path, backend URL, headers: never sent to the browser)
 *   apps/<id>/manifest.json   the accepted Source Manifest
 *   apps/<id>/draft.json      a manifest the discovery drafted, waiting for review
 *   apps/<id>/checks.json     the last health check of each source (no values, only counts and errors)
 *   apps/<id>/rows/<src>.json rows of "memory" sources (data files, the example)
 *   apps/<id>/board.json      the widgets the user added; history.json holds earlier boards for Undo
 *   apps/<id>/chats/<id>.json conversations; files/ the attachments
 *
 * The agents never write here: the server does, after validating what they proposed.
 */
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { type Board, type Manifest, type ManifestInput, type WidgetInput, widgetFields } from "@tomoe/core"
import { z } from "zod"

export const AppId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
export const ChatId = z.string().regex(/^[a-z0-9]{12}$/)
const HeaderName = z.string().regex(/^[A-Za-z0-9-]{1,60}$/, "a header name")

export const Connection = z
  .object({
    /** A local checkout of the host app's code, read by the agents (never written). */
    repo: z.string().trim().min(1).max(1000).optional(),
    /** The host's website or web app (production): read by recon and the discovery agent; base of navigate actions. */
    website: z.url({ protocol: /^https?$/ }).max(500).optional(),
    /** The host's backend: GET requests only, pinned to this origin. */
    url: z.url({ protocol: /^https?$/ }).max(500).optional(),
    /** An OpenAPI/Swagger document describing the backend. */
    openapi: z.url({ protocol: /^https?$/ }).max(500).optional(),
    /** Sent with every request to the backend (e.g. Authorization). Kept on the server. */
    headers: z.record(HeaderName, z.string().max(4000)).default({}),
    /** Screenshots of the app (attachments of this app), shown to the discovery agent. */
    files: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict()
export type Connection = z.infer<typeof Connection>

/**
 * A change to a connection (PATCH): only what is sent changes. No defaults here, so a partial change
 * never resets headers or screenshots; null removes a URL or the repo.
 */
export const ConnectionPatch = z
  .object({
    repo: Connection.shape.repo.unwrap().nullable().optional(),
    website: Connection.shape.website.unwrap().nullable().optional(),
    url: Connection.shape.url.unwrap().nullable().optional(),
    openapi: Connection.shape.openapi.unwrap().nullable().optional(),
    headers: z.record(HeaderName, z.string().max(4000)).optional(),
    files: z.array(z.string().max(300)).max(10).optional(),
  })
  .strict()
export type ConnectionPatch = z.infer<typeof ConnectionPatch>

const originOf = (url: string | undefined) => (url ? new URL(url).origin : null)

/**
 * Applies a patch. Header values are write-only: one sent as "" or "•••" keeps the stored value (the
 * browser never has it); a header left out is removed. Stored values are only kept for the origin
 * they were given for: when the API base URL moves to another origin, every header needs a new value.
 */
export function patchConnection(current: Connection, patch: ConnectionPatch): Connection {
  const next: Connection = { ...current, headers: { ...current.headers }, files: [...current.files] }
  for (const k of ["repo", "website", "url", "openapi"] as const) {
    const v = patch[k]
    if (v === null) delete next[k]
    else if (v !== undefined) next[k] = v
  }
  const kept = originOf(next.url) === originOf(current.url) ? current.headers : {}
  next.headers = Object.fromEntries(
    Object.entries(patch.headers ?? kept)
      .map(([k, v]) => [k, v === "" || v === "•••" ? (kept[k] ?? "") : v] as const)
      .filter(([, v]) => v !== "")
  )
  if (patch.files) next.files = patch.files
  return next
}

export type AppKind = "playground" | "example" | "connected"
export type AppRecord = { id: string; name: string; kind: AppKind; created: string; connection: Connection }
export type Draft = { manifest: unknown; problems: string[]; created: string }
/** The last health check of each source (Settings → Test), keyed by source id. */
export type Checks = Record<string, { at: string; ok: boolean; rows: number | null; ms: number; missing: string[]; error: string | null }>

export type ChatMessage = {
  role: "user" | "assistant"
  text: string
  tools: { name: string; detail: string }[]
  files?: ChatFile[]
  error?: string
}
export type Chat = { id: string; title: string; session: string | null; created: string; updated: string; about?: string; messages: ChatMessage[] }
export type ChatFile = { path: string; name: string; image: boolean; size: number; type: string }

const MAX_WIDGETS = 60
const MAX_HISTORY = 50

export const now = () => new Date().toISOString()
const json = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}
/** Written whole or not at all. */
function write(path: string, value: unknown) {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  renameSync(tmp, path)
}

export const PLAYGROUND = "playground"

export function emptyManifest(name: string): ManifestInput {
  return { version: 1, app: { name, description: "Nothing connected yet.", locale: "en" }, sources: [], actions: [] }
}

export class Store {
  readonly root: string
  private locks = new Map<string, Promise<unknown>>()

  constructor(data: string) {
    this.root = join(data, "apps")
    mkdirSync(this.root, { recursive: true })
    if (!existsSync(this.dir(PLAYGROUND))) {
      this.create({ id: PLAYGROUND, name: "Playground", kind: "playground", created: now(), connection: { headers: {}, files: [] } }, emptyManifest("Playground"))
    }
  }

  /** One change at a time per app. */
  private async locked<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.locks.set(key, next.catch(() => {}))
    return next
  }

  dir(id: string) {
    return join(this.root, AppId.parse(id))
  }

  // ---------- apps ----------

  apps(): AppRecord[] {
    return readdirSync(this.root)
      .filter((d) => AppId.safeParse(d).success)
      .map((d) => this.app(d))
      .filter((a): a is AppRecord => a !== null)
      .sort((a, b) => (a.kind === "playground" ? -1 : b.kind === "playground" ? 1 : b.created.localeCompare(a.created)))
  }

  app(id: string): AppRecord | null {
    if (!AppId.safeParse(id).success) return null
    return json(join(this.dir(id), "app.json")) as AppRecord | null
  }

  /** A new id from a name: "Example Shop" → "example-shop", "example-shop-2"… */
  newId(name: string): string {
    const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "app"
    let id = base
    for (let n = 2; existsSync(join(this.root, id)); n++) id = `${base}-${n}`
    return id
  }

  create(app: AppRecord, manifest?: ManifestInput) {
    const dir = this.dir(app.id)
    mkdirSync(join(dir, "chats"), { recursive: true })
    write(join(dir, "app.json"), app)
    if (manifest) write(join(dir, "manifest.json"), manifest)
    write(join(dir, "board.json"), { version: 1, widgets: [] })
  }

  updateApp(id: string, change: (a: AppRecord) => AppRecord) {
    return this.locked(`${id}/app`, () => {
      const a = this.app(id)
      if (!a) throw new Error("unknown app")
      const next = change(a)
      write(join(this.dir(id), "app.json"), next)
      return next
    })
  }

  deleteApp(id: string) {
    if (id === PLAYGROUND || !this.app(id)) return false
    rmSync(this.dir(id), { recursive: true, force: true })
    return true
  }

  // ---------- manifest ----------

  manifest(id: string): unknown {
    return json(join(this.dir(id), "manifest.json"))
  }

  /** When the accepted manifest was last saved, or null. */
  manifestSaved(id: string): string | null {
    try {
      return statSync(join(this.dir(id), "manifest.json")).mtime.toISOString()
    } catch {
      return null
    }
  }

  checks(id: string): Checks {
    const c = json(join(this.dir(id), "checks.json"))
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Checks) : {}
  }

  saveChecks(id: string, update: Checks) {
    return this.locked(`${id}/checks`, () => {
      const next = { ...this.checks(id), ...update }
      write(join(this.dir(id), "checks.json"), next)
      return next
    })
  }

  saveManifest(id: string, m: Manifest) {
    return this.locked(`${id}/manifest`, () => {
      write(join(this.dir(id), "manifest.json"), m)
      rmSync(join(this.dir(id), "draft.json"), { force: true })
    })
  }

  draft(id: string): Draft | null {
    return json(join(this.dir(id), "draft.json")) as Draft | null
  }

  saveDraft(id: string, draft: Draft) {
    return this.locked(`${id}/manifest`, () => write(join(this.dir(id), "draft.json"), draft))
  }

  discardDraft(id: string) {
    rmSync(join(this.dir(id), "draft.json"), { force: true })
  }

  /** Rows of a "memory" source; null when there are none. */
  memoryRows(id: string, source: string): Record<string, unknown>[] | null {
    const rows = json(join(this.dir(id), "rows", `${source}.json`))
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null
  }

  saveMemoryRows(id: string, source: string, rows: Record<string, unknown>[]) {
    mkdirSync(join(this.dir(id), "rows"), { recursive: true })
    write(join(this.dir(id), "rows", `${source}.json`), rows)
  }

  // ---------- board ----------

  /** As stored: validate it with the app's Tomoe (loadBoard) before use. */
  rawBoard(id: string): unknown {
    return json(join(this.dir(id), "board.json")) ?? { version: 1, widgets: [] }
  }

  history(id: string): { label: string; at: string }[] {
    const h = json(join(this.dir(id), "history.json"))
    return Array.isArray(h) ? h.map((x: { label: string; at: string }) => ({ label: x.label, at: x.at })).reverse() : []
  }

  /** One change = one revision: the board before it goes on the history, for Undo. */
  private commit(id: string, label: string | ((before: Board) => string), change: (b: Board) => Board | null, load: (raw: unknown) => Board) {
    return this.locked(`${id}/board`, () => {
      const dir = this.dir(id)
      const before = load(this.rawBoard(id))
      const after = change(structuredClone(before))
      if (!after) return before
      const h = json(join(dir, "history.json"))
      const history = Array.isArray(h) ? h : []
      history.push({ label: typeof label === "string" ? label : label(before), at: now(), board: before })
      write(join(dir, "history.json"), history.slice(-MAX_HISTORY))
      write(join(dir, "board.json"), after)
      return after
    })
  }

  saveWidget(id: string, w: WidgetInput, load: (raw: unknown) => Board) {
    let added = false
    return this.commit(
      id,
      (b) => `${b.widgets.some((x) => x.id === w.id) ? "Update" : "Add"} ${w.title}`,
      (b) => {
        const i = b.widgets.findIndex((x) => x.id === w.id)
        const stamp = now()
        if (i >= 0) b.widgets[i] = { ...widgetFields(w), created: b.widgets[i].created, updated: stamp }
        else {
          if (b.widgets.length >= MAX_WIDGETS) throw new Error(`the board holds at most ${MAX_WIDGETS} widgets`)
          b.widgets.push({ ...widgetFields(w), created: stamp, updated: stamp })
          added = true
        }
        return b
      },
      load
    ).then((board) => ({ board, added }))
  }

  removeWidget(id: string, widget: string, load: (raw: unknown) => Board) {
    return this.commit(
      id,
      `Remove ${widget}`,
      (b) => {
        const i = b.widgets.findIndex((x) => x.id === widget)
        if (i < 0) return null
        b.widgets.splice(i, 1)
        return b
      },
      load
    )
  }

  moveWidget(id: string, widget: string, index: number, load: (raw: unknown) => Board) {
    return this.commit(
      id,
      `Move ${widget}`,
      (b) => {
        const i = b.widgets.findIndex((x) => x.id === widget)
        const to = Math.max(0, Math.min(b.widgets.length - 1, Math.trunc(index)))
        if (i < 0 || i === to) return null
        const [w] = b.widgets.splice(i, 1)
        b.widgets.splice(to, 0, w)
        return b
      },
      load
    )
  }

  /** The board before the last change; the change is dropped from the history. */
  undo(id: string, load: (raw: unknown) => Board) {
    return this.locked(`${id}/board`, () => {
      const dir = this.dir(id)
      const h = json(join(dir, "history.json"))
      if (!Array.isArray(h) || !h.length) return null
      const last = h.pop()
      write(join(dir, "board.json"), load(last.board))
      write(join(dir, "history.json"), h)
      return { board: load(last.board), undone: String(last.label) }
    })
  }

  // ---------- chats ----------

  chats(id: string): { id: string; title: string; updated: string }[] {
    const dir = join(this.dir(id), "chats")
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => json(join(dir, f)) as Chat | null)
      .filter((c): c is Chat => c !== null)
      .map((c) => ({ id: c.id, title: c.title, updated: c.updated }))
      .sort((a, b) => b.updated.localeCompare(a.updated))
  }

  chat(id: string, chat: string): Chat | null {
    if (!ChatId.safeParse(chat).success) return null
    return json(join(this.dir(id), "chats", `${chat}.json`)) as Chat | null
  }

  newChat(title: string, about?: string): Chat {
    const stamp = now()
    return { id: randomBytes(6).toString("hex"), title: title.slice(0, 80) || "New chat", session: null, created: stamp, updated: stamp, ...(about ? { about } : {}), messages: [] }
  }

  saveChat(id: string, chat: Chat) {
    return this.locked(`${id}/chat/${chat.id}`, () => {
      mkdirSync(join(this.dir(id), "chats"), { recursive: true })
      write(join(this.dir(id), "chats", `${chat.id}.json`), { ...chat, updated: now() })
    })
  }

  deleteChat(id: string, chat: string) {
    if (!ChatId.safeParse(chat).success) return false
    rmSync(join(this.dir(id), "chats", `${chat}.json`), { force: true })
    return true
  }
}
