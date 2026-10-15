/**
 * Runs Claude Code headless (`claude -p`, the unmodified binary on the user's own Claude subscription)
 * and turns its stream into simple chat events; the same way Autocratico's chat does. Security-sensitive:
 * the tool profiles below are what keeps the agents read-only, enforced by Claude Code's permissions,
 * not by the prompt.
 *
 * chat      reads the attachments and the connected repo (Read, Glob, Grep); asks Tomoe's MCP tools for
 *           data (run_query, distinct, read_board: capped, sensitive values masked); WebFetch only on the
 *           domains of links the user typed in that message. No Bash, no Edit/Write, no other MCP server.
 * discover  reads the repo and the screenshots; GETs the app's own origins (website, API, OpenAPI document)
 *           through Tomoe's http_get (capped; the auth headers only go to the API); WebFetch only on the
 *           app's own domains; checks its draft with check_manifest. Same denials, no web search.
 *
 * Settings, hooks, plugins and MCP servers of the user's own Claude Code setup are not loaded
 * (--setting-sources "" and --strict-mcp-config): the connected repo's .claude/ never runs either.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"

export type Profile = "chat" | "discover"
export type ChatEvent =
  | { type: "chat"; id: string }
  | { type: "session"; id: string }
  | { type: "block" }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "final"; text: string }
  | { type: "status"; text: string }
  | { type: "manifest"; draft: unknown; problems: string[] }
  | { type: "recon"; findings: unknown[]; suggested: Record<string, string | undefined> }
  | { type: "end"; cost: number | null; duration_ms: number | null }
  | { type: "error"; message: string }

const SESSION = /^[0-9a-f-]{36}$/
const SECRET_FILES = ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/id_rsa*", "**/id_ed25519*", "**/.npmrc", "**/.netrc", "**/secrets/**", "**/.git/**"]

// `//` marks an absolute path in Claude Code permission rules.
const abs = (p: string) => `/${p}`

export function tools(o: { app: string; webDomains?: string[] }): { available: string[]; allowed: string[]; denied: string[] } {
  const hidden = [...SECRET_FILES, `${abs(o.app)}/*.json`, `${abs(o.app)}/chats/**`, `${abs(o.app)}/rows/**`].flatMap((p) => [`Read(${p})`, `Grep(${p})`, `Glob(${p})`])
  const web = (o.webDomains ?? []).map((d) => `WebFetch(domain:${d})`)
  return {
    available: ["Read", "Glob", "Grep", ...(web.length ? ["WebFetch"] : [])],
    allowed: ["Read", "Glob", "Grep", "mcp__tomoe", ...web],
    denied: ["Bash", "Edit", "Write", "NotebookEdit", "Task", "WebSearch", ...hidden],
  }
}

function detail(name: string, args: Record<string, unknown>, bases: string[]): string {
  if (name.startsWith("mcp__tomoe__")) {
    const q = (args.query ?? args) as Record<string, unknown>
    return [q.from, args.source, args.field, args.path].filter((v) => typeof v === "string").join(" · ")
  }
  for (const field of ["file_path", "pattern", "url", "path", "query"]) {
    const v = args[field]
    if (typeof v === "string") {
      if (field !== "file_path") return v
      for (const b of bases) if (v.startsWith(`${b}/`)) return relative(b, v)
      return v
    }
  }
  return ""
}

export type RunOptions = {
  prompt: string
  profile: Profile
  /** apps/<id>: never readable by the agent (connection headers, chats). */
  app: string
  /** The agent's working folder (attachments live under it). */
  cwd: string
  /** The connected repo, read-only. */
  repo?: string
  session?: string | null
  instructions: string
  /** Tomoe's MCP tools: how the agent reaches the data. */
  mcp: { url: string; token: string; appId: string }
  webDomains?: string[]
  signal?: AbortSignal
}

/** Plain-language text for errors from `claude -p`. */
export function friendlyError(message: string): string {
  if (/usage limit|rate.?limit|limit (reached|exceeded)|429|overloaded/i.test(message)) return "Claude subscription usage limit reached: try again later."
  if (/401|unauthori[sz]ed|oauth|invalid api key|authentication|not logged in|\/login/i.test(message)) return "Claude Code is not signed in on this machine: run `claude` once and log in with your subscription."
  if (/max_turns/i.test(message)) return "That took too many steps: try splitting it into simpler requests."
  if (/not found in PATH/i.test(message)) return "Claude Code is not installed: install it and log in with your subscription."
  return `The agent stopped with an error: ${message.slice(0, 300)}`
}

export class Claude {
  readonly executable: string | null

  constructor(executable: string | null) {
    this.executable = executable
  }

  get available() {
    return this.executable !== null
  }

  /** Whether Claude Code still has this session on disk (resuming a missing one fails the whole run). */
  sessionExists(id: string): boolean {
    const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects")
    try {
      return readdirSync(projects).some((dir) => existsSync(join(projects, dir, `${id}.jsonl`)))
    } catch {
      return false
    }
  }

  /** Yields session · block · text · tool · end · error. */
  async *run(o: RunOptions): AsyncGenerator<ChatEvent> {
    if (!this.executable) {
      yield { type: "error", message: "`claude` command not found in PATH." }
      return
    }
    mkdirSync(o.cwd, { recursive: true })
    const { available, allowed, denied } = tools({ app: o.app, webDomains: o.webDomains })
    const mcp = {
      mcpServers: {
        tomoe: {
          type: "stdio",
          command: process.execPath,
          args: [join(import.meta.dirname, "mcp.ts")],
          env: { TOMOE_URL: o.mcp.url, TOMOE_TOKEN: o.mcp.token, TOMOE_APP: o.mcp.appId, TOMOE_PROFILE: o.profile },
        },
      },
    }
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--setting-sources", "",
      "--strict-mcp-config",
      "--mcp-config", JSON.stringify(mcp),
      "--permission-mode", "dontAsk",
      "--tools", ...available,
      "--allowedTools", ...allowed,
      "--disallowedTools", ...denied,
      "--append-system-prompt", o.instructions,
    ]
    if (o.repo) args.push("--add-dir", o.repo)
    if (o.session && SESSION.test(o.session) && this.sessionExists(o.session)) args.push("--resume", o.session)

    const child = spawn(this.executable, args, {
      cwd: o.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: `tomoe-${o.profile}` },
    })
    const kill = () => child.exitCode === null && child.kill()
    o.signal?.addEventListener("abort", kill, { once: true })
    let stderr = ""
    child.stderr.setEncoding("utf8").on("data", (s: string) => (stderr = (stderr + s).slice(-4000)))
    const exited = new Promise<number | null>((resolve) => child.once("close", resolve))
    child.stdin.end(o.prompt)

    const bases = [o.cwd, ...(o.repo ? [o.repo] : [])]
    let finished = false
    let rest = ""
    try {
      for await (const chunk of child.stdout.setEncoding("utf8")) {
        rest += chunk
        const lines = rest.split("\n")
        rest = lines.pop() ?? ""
        for (const line of lines) {
          for (const e of translate(line, bases)) {
            if (e.type === "end") finished = true
            yield e
          }
        }
      }
      for (const e of translate(rest, bases)) {
        if (e.type === "end") finished = true
        yield e
      }
      const code = await exited
      if (!finished && !o.signal?.aborted) {
        const last = stderr.trim().split("\n").at(-1)
        yield { type: "error", message: last || `claude exited with code ${code}` }
      }
    } finally {
      kill()
      o.signal?.removeEventListener("abort", kill)
    }
  }
}

function* translate(line: string, bases: string[]): Generator<ChatEvent> {
  if (!line.trim()) return
  let e: Record<string, any>
  try {
    e = JSON.parse(line)
  } catch {
    return
  }
  if (e.type === "system" && e.subtype === "init") {
    yield { type: "session", id: String(e.session_id) }
  } else if (e.type === "stream_event" && e.parent_tool_use_id == null) {
    const ev = e.event ?? {}
    if (ev.type === "content_block_start" && ev.content_block?.type === "text") yield { type: "block" }
    else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") yield { type: "text", text: String(ev.delta.text) }
  } else if (e.type === "assistant" && e.parent_tool_use_id == null) {
    for (const c of e.message?.content ?? []) {
      if (c.type === "tool_use") yield { type: "tool", name: String(c.name ?? "").replace(/^mcp__tomoe__/, ""), detail: detail(String(c.name ?? ""), c.input ?? {}, bases) }
    }
  } else if (e.type === "result") {
    if (e.is_error) {
      const details = Array.isArray(e.errors) ? e.errors.map(String).join("; ") : ""
      yield { type: "error", message: [e.subtype, e.result, details].filter(Boolean).map(String).join(": ") || "error" }
    }
    yield { type: "end", cost: e.total_cost_usd ?? null, duration_ms: e.duration_ms ?? null }
  }
}
