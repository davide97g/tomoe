/**
 * Creative mode's sandbox (references/blueprint.md §7): the page is packages/core/sandbox/widget.html.
 * Three walls: an iframe with sandbox="allow-scripts" and no allow-same-origin (opaque origin), the
 * widget's code in a Web Worker (no DOM, nothing to navigate), and what it draws sanitized against a
 * whitelist; under a CSP that runs only the page's own script, by hash, and lets nothing connect or load.
 * test/sandbox.test.ts keeps the hash in step with the page. Never add allow-same-origin, loosen the CSP
 * or run the code on the host page.
 */
import { z } from "zod"

import { buildOpenTarget } from "./catalog.ts"
import type { Manifest } from "./manifest.ts"

export const SANDBOX_CSP =
  "default-src 'none'; script-src 'sha256-zeuyzIvHv0MB8eWNk56PntXiMChfWL7fZX/gweP2yD8='; worker-src blob:; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; manifest-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"

/** Headers for the sandbox page's own route (it skips the app's usual headers). */
export const SANDBOX_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-cache",
  "Content-Security-Policy": SANDBOX_CSP,
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=(), display-capture=()",
}

/** The iframe's attributes, exactly. */
export const SANDBOX_IFRAME = { sandbox: "allow-scripts", referrerPolicy: "no-referrer" } as const

/** CSS variables the host passes to the frame (the frame accepts only names and values that look like tokens). */
export const SANDBOX_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "muted",
  "muted-foreground",
  "border",
  "primary",
  "primary-foreground",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "positive",
  "negative",
  "warning",
  "radius",
]

/** Frame heights the host accepts. */
export const SANDBOX_HEIGHT = { min: 24, max: 900 }

export type SandboxMessage =
  | { type: "ready" }
  | { type: "resize"; height: number }
  | { type: "open"; target: { action: string; params?: Record<string, string> } }
  | { type: "ask"; question: string }
  | { type: "error"; message: string }

/**
 * What the frame may ask the host; anything else is ignored. The host also checks
 * `event.source === iframe.contentWindow`, builds `open` paths itself (actionPath), and only offers an
 * `ask` to the user: a widget must never be able to drive the agent.
 */
export function buildSandboxMessage(m: Manifest): z.ZodType<SandboxMessage> {
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("ready") }),
    z.object({ type: z.literal("resize"), height: z.number().min(0).max(100_000) }),
    z.object({ type: z.literal("open"), target: buildOpenTarget(m) }),
    z.object({ type: z.literal("ask"), question: z.string().trim().min(1).max(500) }),
    z.object({ type: z.literal("error"), message: z.string().max(500) }),
  ]) as unknown as z.ZodType<SandboxMessage>
}

/** What the host sends: once `init` (with the code) after `ready`, then `update` on every change. */
export type SandboxState = {
  data: Record<string, unknown[] | null>
  today: string
  locale: string
  currency: string
  theme: "light" | "dark"
  privacy: boolean
  tokens: Record<string, string>
}
export type HostMessage = ({ type: "init"; code: string } & SandboxState) | ({ type: "update" } & SandboxState)
