/**
 * Settings, from the environment. Tomoe runs on the user's own machine and listens on loopback only:
 * the agent runs on the user's Claude subscription (`claude -p`), and the apps it connects to are
 * reached with the user's own credentials.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

export type Config = {
  port: number
  host: string
  /** Where apps, boards and chats are kept (TOMOE_DATA, default var/ in the repo). */
  data: string
  /** The repo root. */
  root: string
  /** The `claude` executable, or null when Claude Code is not installed. */
  claude: string | null
  /** Built web client, served when present. */
  web: string
  /** The sandbox page from @tomoe/core. */
  sandbox: string
  /** Where the tomoe-ready skill is published, for `npx skills add <repo> --skill tomoe-ready`. */
  skillRepo: string
}

function which(cmd: string): string | null {
  try {
    return execFileSync("/usr/bin/env", ["which", cmd], { encoding: "utf8" }).trim() || null
  } catch {
    return null
  }
}

export function loadConfig(env = process.env): Config {
  const root = resolve(import.meta.dirname, "../../..")
  const data = resolve(env.TOMOE_DATA || resolve(root, "var"))
  mkdirSync(data, { recursive: true })
  const claude = env.TOMOE_CLAUDE || which("claude")
  return {
    port: Number(env.PORT ?? 8791),
    host: "127.0.0.1",
    data,
    root,
    claude: claude && existsSync(claude) ? claude : null,
    web: resolve(root, "apps/web/dist"),
    sandbox: resolve(root, "packages/core/sandbox/widget.html"),
    skillRepo: env.TOMOE_SKILL_REPO || "davide97g/tomoe",
  }
}
