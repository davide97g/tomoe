/**
 * Tomoe's HTTP API. Loopback only; requests must name a local host (no DNS rebinding) and writes must
 * come from a local page (Origin). The agent's MCP tools call /api/agent with a per-process token.
 */
import { randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join, relative, resolve, sep } from "node:path"

import { serveStatic } from "@hono/node-server/serve-static"
import { finishAnswer, issueLine, parseManifest, renderAnswer, SANDBOX_HEADERS, stripBlocks, WidgetId } from "@tomoe/core"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { z } from "zod"

import { appOrigins, attachmentsNote, chatInstructions, discoveryInstructions, manifestBlock, probe, runTool, stripManifest } from "./agent.ts"
import { type ChatEvent, Claude, friendlyError } from "./claude.ts"
import type { Config } from "./config.ts"
import { shopRows } from "../../../examples/shop/data.ts"
import { inferSource } from "./infer.ts"
import { type Recon, recon, reconNote } from "./recon.ts"
import { AppId, type AppRecord, type ChatFile, type ChatMessage, Connection, now, Store } from "./store.ts"
import { today, type Workspace, Workspaces } from "./workspace.ts"

const MAX_FILES = 10
const MAX_FILE = 25_000_000
const MAX_LINKS = 4
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }
const FILES = /^files\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\/[^/\\]+$/
const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/

const ChatBody = z.object({
  message: z.string().max(20_000).default(""),
  chat: z.string().nullable().optional(),
  files: z.array(z.string().max(300)).max(MAX_FILES).default([]),
  about: z.string().max(100).optional(),
})
const NewApp = z.object({ name: z.string().trim().min(1).max(80), connection: Connection })
const PatchApp = z.object({ name: z.string().trim().min(1).max(80).optional(), connection: Connection.partial().optional() })

export type Services = { config: Config; store: Store; workspaces: Workspaces; claude: Claude; token: string; agentUrl: () => string }

export function services(config: Config): Services {
  const store = new Store(config.data)
  return {
    config,
    store,
    workspaces: new Workspaces(store),
    claude: new Claude(config.claude),
    token: randomBytes(24).toString("hex"),
    agentUrl: () => `http://127.0.0.1:${config.port}`,
  }
}

/** The app as the browser sees it: header values stay on the server. */
const publicApp = (a: AppRecord) => ({ ...a, connection: { ...a.connection, headers: Object.fromEntries(Object.keys(a.connection.headers).map((k) => [k, "•••"])) } })

const safeName = (name: string, taken: string[]) => {
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10)
  const stem = basename(name, extname(name)).normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "file"
  let n = `${stem}${ext}`
  for (let i = 2; taken.includes(n); i++) n = `${stem}-${i}${ext}`
  return n
}

function newFolder(ws: Workspace) {
  const folder = `files/${today()}-${randomBytes(4).toString("hex")}`
  mkdirSync(join(ws.cwd, folder), { recursive: true })
  return folder
}

function fileInfo(ws: Workspace, path: string): ChatFile {
  const ext = extname(path).toLowerCase()
  return { path, name: basename(path), image: ext in IMAGE_TYPES, size: statSync(join(ws.cwd, path)).size, type: IMAGE_TYPES[ext] ?? (ext === ".pdf" ? "application/pdf" : ext === ".csv" ? "text/csv" : ext === ".json" ? "application/json" : "") }
}

/** Absolute path of an attachment, or null: only files under files/, real path checked. */
function attachment(ws: Workspace, path: string): string | null {
  if (!FILES.test(path) || path.split("/").some((p) => p.startsWith("."))) return null
  try {
    const root = realpathSync(join(ws.cwd, "files"))
    const real = realpathSync(join(ws.cwd, path))
    return real.startsWith(root + sep) && statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}

/** Links in a message: images are saved for the agent to see; other pages it may open with WebFetch. */
async function readLinks(ws: Workspace, message: string): Promise<{ links: { url: string; saved?: string; note?: string }[]; domains: string[]; files: ChatFile[] }> {
  const urls = [...new Set(message.match(/https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g) ?? [])].slice(0, MAX_LINKS)
  const links: { url: string; saved?: string; note?: string }[] = []
  const domains = new Set<string>()
  const files: ChatFile[] = []
  for (const url of urls) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      continue
    }
    domains.add(u.hostname)
    if (!/\.(png|jpe?g|gif|webp)$/i.test(u.pathname)) {
      links.push({ url })
      continue
    }
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: "follow" })
      const type = r.headers.get("content-type")?.split(";")[0] ?? ""
      const ext = Object.entries(IMAGE_TYPES).find(([, t]) => t === type)?.[0]
      const body = new Uint8Array(await r.arrayBuffer())
      if (!r.ok || !ext || body.length > MAX_FILE) {
        links.push({ url, note: !r.ok ? `HTTP ${r.status}` : "not an image the server keeps" })
        continue
      }
      const folder = newFolder(ws)
      const path = `${folder}/${safeName(basename(u.pathname, extname(u.pathname)) + ext, [])}`
      writeFileSync(join(ws.cwd, path), body)
      files.push(fileInfo(ws, path))
      links.push({ url, saved: join(ws.cwd, path) })
    } catch (e) {
      links.push({ url, note: (e as Error).message.slice(0, 120) })
    }
  }
  return { links, domains: [...domains], files }
}

export function createApp(s: Services) {
  const { store, workspaces, claude, config } = s
  const app = new Hono()

  // ---------- local only ----------
  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? ""
    if (!LOCAL.test(host)) return c.text("Tomoe only answers on localhost", 403)
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !c.req.path.startsWith("/api/agent/")) {
      const origin = c.req.header("origin")
      if (origin && !LOCAL.test(origin.replace(/^https?:\/\//, ""))) return c.json({ error: "cross-origin request refused" }, 403)
    }
    await next()
    if (!c.req.path.startsWith("/sandbox/")) {
      c.header("X-Content-Type-Options", "nosniff")
      c.header("Referrer-Policy", "no-referrer")
      c.header("X-Frame-Options", "SAMEORIGIN")
    }
  })

  const ws = (id: string): Workspace | null => (AppId.safeParse(id).success ? workspaces.get(id) : null)

  // ---------- status, apps ----------

  app.get("/api/status", (c) => c.json({ claude: claude.available, today: today(), skill: { repo: config.skillRepo, name: "tomoe-ready" } }))

  // Test a URL before connecting it: what it publishes about itself (llms.txt, OpenAPI, MCP, tomoe.json…).
  app.post("/api/recon", async (c) => {
    const url = String((await c.req.json().catch(() => null))?.url ?? "").slice(0, 500)
    if (!url.trim()) return c.json({ error: "give a URL" }, 400)
    try {
      const r = await recon(url)
      return c.json({ ...r, manifest: r.manifest ? { sources: r.manifest.sources.map((x) => x.label) } : undefined })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  app.get("/api/apps", (c) => c.json(store.apps().map(publicApp)))

  app.post("/api/apps", async (c) => {
    const body = NewApp.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: issueLine(body.error) }, 400)
    const { connection } = body.data
    if (connection.repo) {
      const repo = resolve(connection.repo.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"))
      if (!existsSync(repo) || !statSync(repo).isDirectory()) return c.json({ error: `${repo} is not a folder on this machine` }, 400)
      connection.repo = repo
    }
    if (!connection.repo && !connection.url && !connection.openapi && !connection.website) return c.json({ error: "give a website, an API URL, an OpenAPI document or a repo folder" }, 400)
    const record: AppRecord = { id: store.newId(body.data.name), name: body.data.name, kind: "connected", created: now(), connection }
    store.create(record)
    return c.json(publicApp(record))
  })

  // The made-up shop, ready to use: its rows kept by Tomoe ("memory" sources).
  app.post("/api/apps/example", async (c) => {
    const read = (f: string) => JSON.parse(readFileSync(join(config.root, "examples/shop", f), "utf8"))
    const manifest = read("manifest.json")
    for (const src of manifest.sources) src.origin = { kind: "memory" }
    const parsed = parseManifest(manifest)
    if ("error" in parsed) return c.json({ error: parsed.error }, 500)
    const record: AppRecord = { id: store.newId("Example Shop"), name: "Example Shop", kind: "example", created: now(), connection: { headers: {}, files: [] } }
    store.create(record, parsed.manifest)
    const rows = shopRows()
    store.saveMemoryRows(record.id, "orders", rows.orders)
    store.saveMemoryRows(record.id, "customers", rows.customers)
    return c.json(publicApp(record))
  })

  app.get("/api/apps/:id", (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    return c.json({ app: publicApp(w.record()), manifest: w.tomoe.manifest, draft: store.draft(w.id), history: store.history(w.id).slice(0, 20) })
  })

  app.patch("/api/apps/:id", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const body = PatchApp.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: issueLine(body.error) }, 400)
    const next = await store.updateApp(w.id, (a) => ({
      ...a,
      name: body.data.name ?? a.name,
      // Headers sent as "•••" keep their stored value.
      connection: body.data.connection
        ? {
            ...a.connection,
            ...body.data.connection,
            headers: Object.fromEntries(Object.entries(body.data.connection.headers ?? a.connection.headers).map(([k, v]) => [k, v === "•••" ? (a.connection.headers[k] ?? "") : v])),
          }
        : a.connection,
    }))
    w.adapter.clear()
    return c.json(publicApp(next))
  })

  app.delete("/api/apps/:id", (c) => {
    const id = c.req.param("id")
    workspaces.forget(id)
    return c.json({ ok: AppId.safeParse(id).success && store.deleteApp(id) })
  })

  // ---------- manifest ----------

  app.post("/api/apps/:id/manifest", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const r = parseManifest((await c.req.json().catch(() => null))?.manifest)
    if ("error" in r) return c.json({ error: r.error }, 400)
    await store.saveManifest(w.id, r.manifest)
    workspaces.forget(w.id)
    return c.json({ manifest: r.manifest })
  })

  app.delete("/api/apps/:id/draft", (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    store.discardDraft(w.id)
    return c.json({ ok: true })
  })

  // A data file attached in the chat becomes a source: a draft for the user to review.
  app.post("/api/apps/:id/datafile", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const path = String((await c.req.json().catch(() => null))?.path ?? "")
    const file = attachment(w, path)
    if (!file || !/\.(csv|tsv|json|txt)$/i.test(file)) return c.json({ error: "attach a CSV or JSON file first" }, 400)
    const current = store.draft(w.id)?.manifest ?? w.tomoe.manifest
    const base = parseManifest(current)
    const m = "manifest" in base ? base.manifest : w.tomoe.manifest
    const r = inferSource(basename(file).replace(/^\d+-/, ""), readFileSync(file, "utf8"), m.sources.map((x) => x.id))
    if ("error" in r) return c.json({ error: r.error }, 400)
    const draft = { ...m, app: w.record().kind === "playground" ? { ...m.app, description: "Data files you attached." } : m.app, sources: [...m.sources, r.source] }
    const checked = parseManifest(draft)
    if ("error" in checked) return c.json({ error: checked.error }, 400)
    store.saveMemoryRows(w.id, r.source.id, r.rows)
    await store.saveDraft(w.id, { manifest: checked.manifest, problems: [], created: now() })
    return c.json({ draft: checked.manifest, source: r.source.id })
  })

  // Discovery: the agent reads the repo and the backend and drafts the manifest (streamed).
  app.post("/api/apps/:id/discover", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const signal = c.req.raw.signal
    c.header("Content-Type", "application/x-ndjson; charset=utf-8")
    c.header("X-Accel-Buffering", "no")
    const useAgent = c.req.query("agent") === "1"
    return stream(c, async (out) => {
      const send = (e: ChatEvent) => (out.aborted ? undefined : out.write(JSON.stringify(e) + "\n"))
      let record = w.record()
      // 1. Recon on the website (or the API): deterministic, fast, seeds everything else.
      const target = record.connection.website ?? record.connection.url ?? record.connection.openapi
      let found: Recon | null = null
      if (target) {
        await send({ type: "status", text: `Looking for llms.txt, OpenAPI, MCP and tomoe.json on ${new URL(target).host}…` })
        found = await recon(target).catch(() => null)
        if (found) {
          await send({ type: "recon", findings: found.findings, suggested: found.suggested })
          // What recon found fills what the user left empty.
          const sug = found.suggested
          record = await store.updateApp(w.id, (a) => ({
            ...a,
            connection: {
              ...a.connection,
              url: a.connection.url ?? sug.api,
              openapi: a.connection.openapi ?? sug.openapi,
              website: a.connection.website ?? (sug.website && sug.website !== sug.api ? sug.website : undefined),
            },
          }))
          w.adapter.clear()
        }
      }
      // 2. A Tomoe-ready app publishes its manifest: no agent needed, only the probe.
      if (found?.manifest && !useAgent) {
        await send({ type: "status", text: "The app publishes its own manifest: probing its sources…" })
        const problems = await probe(found.manifest, record.connection)
        await store.saveDraft(w.id, { manifest: found.manifest, problems, created: now() })
        await send({ type: "final", text: `**${record.name}** is Tomoe-ready: it publishes its manifest through \`/.well-known/tomoe.json\` (${found.manifest.sources.length} sources). Review it and accept.` })
        await send({ type: "manifest", draft: found.manifest, problems })
        return void (await send({ type: "end", cost: null, duration_ms: null }))
      }
      // 3. The agent: website, screenshots, repo, API, with the recon report.
      const screenshots = record.connection.files.filter((f) => attachment(w, f)).map((f) => join(w.cwd, f))
      const domains = appOrigins(record.connection).map((o) => new URL(o).hostname)
      let session: string | null = null
      let prompt = `Discover "${record.name}" and draft its Source Manifest.`
      let answer = ""
      for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
        answer = ""
        for await (const e of claude.run({
          prompt,
          profile: "discover",
          app: store.dir(w.id),
          cwd: w.cwd,
          repo: record.connection.repo,
          session,
          instructions: discoveryInstructions(record, { recon: found ? reconNote(found) : undefined, screenshots }),
          mcp: { url: s.agentUrl(), token: s.token, appId: w.id },
          webDomains: domains,
          signal,
        })) {
          if (e.type === "session") session = e.id
          else if (e.type === "text") answer += e.text
          else if (e.type === "block" && answer) answer += "\n\n"
          if (e.type === "error") return void (await send({ type: "error", message: friendlyError(e.message) }))
          if (e.type !== "end") await send(e)
        }
        const block = manifestBlock(answer)
        const r = block === null ? { error: "no ```manifest block with valid JSON at the end of the answer" } : parseManifest(block)
        if ("manifest" in r) {
          await send({ type: "status", text: "Probing the sources…" })
          const problems = await probe(r.manifest, record.connection)
          await store.saveDraft(w.id, { manifest: r.manifest, problems, created: now() })
          await send({ type: "final", text: stripManifest(answer) })
          await send({ type: "manifest", draft: r.manifest, problems })
          return void (await send({ type: "end", cost: null, duration_ms: null }))
        }
        await send({ type: "status", text: `Fixing the draft: ${r.error}` })
        prompt = `The manifest was refused: ${r.error}. Fix it, check it with check_manifest, and answer again with the whole manifest block.`
      }
      await send({ type: "error", message: "The discovery could not produce a valid manifest. Try again, or point it at a narrower folder." })
    })
  })

  // ---------- rows ----------

  app.get("/api/apps/:id/rows", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const source = c.req.query("source") ?? ""
    const r = await w.adapter.rows(w.tomoe.manifest, source, c.req.query("fresh") === "1")
    return c.json({ rows: r.rows, error: r.error ?? null })
  })

  // ---------- board ----------

  app.get("/api/apps/:id/board", (c) => {
    const w = ws(c.req.param("id"))
    return w ? c.json({ board: w.board(), history: store.history(w.id).slice(0, 20) }) : c.json({ error: "not found" }, 404)
  })

  // A widget from a proposal: checked against the catalog again, whatever the client sends.
  app.put("/api/apps/:id/board/widgets/:wid", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const body = w.tomoe.parseWidget(await c.req.json().catch(() => null))
    if ("error" in body) return c.json({ error: body.error }, 400)
    if (body.widget.id !== c.req.param("wid")) return c.json({ error: "the id does not match" }, 400)
    try {
      const { board, added } = await store.saveWidget(w.id, body.widget, w.load)
      return c.json({ board, added })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  app.delete("/api/apps/:id/board/widgets/:wid", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w || !WidgetId.safeParse(c.req.param("wid")).success) return c.json({ error: "not found" }, 404)
    return c.json({ board: await store.removeWidget(w.id, c.req.param("wid"), w.load) })
  })

  app.post("/api/apps/:id/board/widgets/:wid/move", async (c) => {
    const w = ws(c.req.param("id"))
    const index = Number((await c.req.json().catch(() => null))?.index)
    if (!w || !WidgetId.safeParse(c.req.param("wid")).success || !Number.isFinite(index)) return c.json({ error: "invalid request" }, 400)
    return c.json({ board: await store.moveWidget(w.id, c.req.param("wid"), index, w.load) })
  })

  app.post("/api/apps/:id/board/undo", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const r = await store.undo(w.id, w.load)
    return r ? c.json(r) : c.json({ error: "nothing to undo" }, 400)
  })

  // ---------- chats ----------

  app.get("/api/apps/:id/chats", (c) => {
    const w = ws(c.req.param("id"))
    return w ? c.json(store.chats(w.id)) : c.json({ error: "not found" }, 404)
  })
  app.get("/api/apps/:id/chats/:cid", (c) => {
    const w = ws(c.req.param("id"))
    const chat = w && store.chat(w.id, c.req.param("cid"))
    return chat ? c.json(chat) : c.json({ error: "not found" }, 404)
  })
  app.delete("/api/apps/:id/chats/:cid", (c) => {
    const w = ws(c.req.param("id"))
    return c.json({ ok: !!w && store.deleteChat(w.id, c.req.param("cid")) })
  })

  app.post("/api/apps/:id/files", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    const form = await c.req.parseBody({ all: true }).catch(() => null)
    if (!form) return c.json({ error: "expected multipart/form-data" }, 415)
    const uploads = Object.values(form).flat().filter((v): v is File => v instanceof File && v.size > 0)
    if (!uploads.length) return c.json({ error: "no files" }, 400)
    if (uploads.length > MAX_FILES) return c.json({ error: `at most ${MAX_FILES} files` }, 400)
    if (uploads.some((f) => f.size > MAX_FILE)) return c.json({ error: "a file is over 25 MB" }, 413)
    const folder = newFolder(w)
    const names: string[] = []
    for (const f of uploads) {
      const name = safeName(f.name || "file", names)
      writeFileSync(join(w.cwd, folder, name), new Uint8Array(await f.arrayBuffer()))
      names.push(name)
    }
    return c.json(names.map((n) => fileInfo(w, `${folder}/${n}`)))
  })

  // An attachment: images inline with their exact type, anything else as a download.
  app.get("/api/apps/:id/files", (c) => {
    const w = ws(c.req.param("id"))
    const file = w && attachment(w, c.req.query("path") ?? "")
    if (!file) return c.json({ error: "not found" }, 404)
    const type = IMAGE_TYPES[extname(file).toLowerCase()]
    c.header("Content-Type", type ?? "application/octet-stream")
    c.header("Content-Security-Policy", "default-src 'none'; sandbox")
    if (!type) c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`)
    return c.body(readFileSync(file))
  })

  app.post("/api/apps/:id/chat", async (c) => {
    const w = ws(c.req.param("id"))
    if (!w) return c.json({ error: "not found" }, 404)
    if (c.req.header("content-type")?.split(";")[0] !== "application/json") return c.json({ error: "expected application/json" }, 415)
    const body = ChatBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: issueLine(body.error) }, 400)
    const files = [...new Set(body.data.files)].filter((f) => attachment(w, f)).map((f) => fileInfo(w, f))
    const message = body.data.message.trim() || (files.length ? "(attachments)" : "")
    if (!message) return c.json({ error: "empty message" }, 400)
    const chat = (body.data.chat && store.chat(w.id, body.data.chat)) || store.newChat(message, body.data.about)
    const about = chat.about ?? body.data.about
    const signal = c.req.raw.signal

    c.header("Content-Type", "application/x-ndjson; charset=utf-8")
    c.header("X-Accel-Buffering", "no")
    return stream(c, async (out) => {
      const send = (e: ChatEvent) => (out.aborted ? undefined : out.write(JSON.stringify(e) + "\n"))
      await send({ type: "chat", id: chat.id })
      const answer: ChatMessage = { role: "assistant", text: "", tools: [] }
      let raw = ""
      try {
        const { links, domains, files: fetched } = await readLinks(w, message)
        const all = [...files, ...fetched]
        chat.messages.push({ role: "user", text: message, tools: [], ...(all.length ? { files: all } : {}) })
        await store.saveChat(w.id, chat)
        const run = async function* (prompt: string) {
          for await (const e of claude.run({
            prompt,
            profile: "chat",
            app: store.dir(w.id),
            cwd: w.cwd,
            repo: w.record().connection.repo,
            session: chat.session,
            instructions: chatInstructions(w, { about }),
            mcp: { url: s.agentUrl(), token: s.token, appId: w.id },
            webDomains: domains,
            signal,
          })) {
            if (e.type === "session") chat.session = e.id
            else if (e.type === "tool") answer.tools.push({ name: e.name, detail: e.detail })
            else if (e.type === "error") {
              chat.session = null // nothing worth resuming after a failed run
              answer.error = friendlyError(e.message)
            }
            yield e
          }
        }
        const absolute = all.map((f) => ({ ...f, path: join(w.cwd, f.path) }))
        for await (const e of run(`[Sent ${new Date().toISOString()}]\n\n${message}${attachmentsNote(absolute, links)}`)) {
          if (e.type === "text") raw += e.text
          else if (e.type === "block" && raw) raw += "\n\n"
          if (e.type === "end") continue
          await send(e.type === "error" ? { type: "error", message: answer.error ?? e.message } : e)
        }
        let finished = finishAnswer(raw, w.tomoe.parseWidget)
        // Auto-repair (blueprint §6.3): a refused block goes back to the agent once before the user sees it.
        if (finished.problems.length && !answer.error && chat.session && !signal.aborted) {
          await send({ type: "status", text: "Fixing the widget…" })
          let fix = ""
          for await (const e of run(`[Server: your widget block was refused: ${finished.problems.join("; ")}. Answer with the corrected widget block only, same id, no other text.]`)) {
            if (e.type === "text") fix += e.text
            else if (e.type === "tool" || e.type === "session") await send(e)
          }
          const repaired = finishAnswer(fix, w.tomoe.parseWidget)
          if (repaired.widgets.length && !repaired.problems.length) finished = { ...finished, widgets: [...finished.widgets, ...repaired.widgets].slice(0, 3), problems: [] }
        }
        answer.text = renderAnswer(finished, "preview")
        await send({ type: "final", text: answer.text })
        await send({ type: "end", cost: null, duration_ms: null })
      } catch (e) {
        answer.error = (e as Error).message
        await send({ type: "error", message: answer.error })
      } finally {
        // Stopped halfway: keep what was said, without half-written blocks.
        if (!answer.text) answer.text = stripBlocks(raw)
        chat.messages.push(answer)
        await store.saveChat(w.id, chat)
      }
    })
  })

  // ---------- the agent's tools (mcp.ts) ----------

  app.post("/api/agent/:id/:tool", async (c) => {
    const auth = Buffer.from(c.req.header("authorization") ?? "")
    const expected = Buffer.from(`Bearer ${s.token}`)
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return c.text("unauthorized", 401)
    const w = ws(c.req.param("id"))
    if (!w) return c.text("unknown app", 404)
    try {
      const result = await runTool(w, c.req.param("tool"), await c.req.json().catch(() => ({})))
      return c.text(JSON.stringify(result, null, 1))
    } catch (e) {
      const err = e as Error & { issues?: { path: (string | number)[]; message: string }[] }
      return c.text(err.issues?.length ? `${err.issues[0].path.join(".")}: ${err.issues[0].message}` : err.message, 400)
    }
  })

  // ---------- sandbox and web client ----------

  // The frame custom widgets run in, with its own headers (packages/core/sandbox/widget.html, §7.4).
  app.get("/sandbox/widget.html", (c) => {
    for (const [k, v] of Object.entries(SANDBOX_HEADERS)) c.header(k, v)
    return c.body(readFileSync(config.sandbox, "utf8"))
  })

  if (existsSync(config.web)) {
    const root = relative(process.cwd(), config.web) || "."
    app.use("/*", serveStatic({ root }))
    app.get("*", (c) => c.html(readFileSync(join(config.web, "index.html"), "utf8")))
  }
  return app
}
