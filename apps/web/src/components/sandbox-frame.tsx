/**
 * Runs a custom widget's code in the sandbox page (packages/core/sandbox/widget.html, served by the
 * server with its own CSP): sandbox="allow-scripts" without allow-same-origin, so an opaque origin with
 * no cookies and no /api; there the code runs in a worker that cannot connect anywhere, and what it
 * draws is sanitized. The frame receives only the rows of the widget's own queries (sensitive fields
 * null in privacy mode) and may ask for three things, each checked here: its height, opening one of
 * the manifest's actions, and offering a question for the chat (never sent on its own).
 */
import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"
import { type CustomWidget, customData, SANDBOX_HEIGHT, SANDBOX_IFRAME, SANDBOX_TOKENS, type WidgetInput } from "@tomoe/core"
import { toast } from "sonner"

import { useWorkspace } from "@/lib/workspace"

type Custom = Extract<WidgetInput, { kind: "custom" }> | CustomWidget

function readTheme(): { tokens: Record<string, string>; theme: "light" | "dark" } {
  const css = getComputedStyle(document.documentElement)
  const tokens = Object.fromEntries(SANDBOX_TOKENS.map((t) => [`--${t}`, css.getPropertyValue(`--${t}`).trim()]).filter(([, v]) => v))
  return { tokens, theme: document.documentElement.classList.contains("dark") ? "dark" : "light" }
}

function useThemeVersion(): number {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const o = new MutationObserver(() => setVersion((v) => v + 1))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
    return () => o.disconnect()
  }, [])
  return version
}

export function SandboxFrame({ widget }: { widget: Custom }) {
  const { context, tomoe, privacy, need, pending, open, askChat } = useWorkspace()
  const themeVersion = useThemeVersion()
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = React.useState(160)
  const [problem, setProblem] = React.useState<string | null>(null)
  const [navigated, setNavigated] = React.useState(false)
  const started = React.useRef(false)
  const ready = React.useRef(false)
  const loads = React.useRef(0)

  const sources = React.useMemo(() => [...new Set(Object.values(widget.data).map((q) => q.from))], [widget.data])
  React.useEffect(() => need(sources), [need, sources])
  const loading = pending(sources)

  const message = React.useMemo(() => {
    if (!context || !tomoe || loading) return null
    void themeVersion
    return {
      data: customData(widget.data, context, privacy),
      today: context.today,
      locale: tomoe.manifest.app.locale,
      currency: tomoe.manifest.app.currency ?? "EUR",
      privacy,
      ...readTheme(),
    }
  }, [widget.data, context, tomoe, privacy, loading, themeVersion])
  const latest = React.useRef(message)
  React.useLayoutEffect(() => {
    latest.current = message
  })

  const send = React.useCallback(
    (type: "init" | "update") => {
      const win = frame.current?.contentWindow
      const m = latest.current
      if (!win || !m) return
      // The frame's origin is opaque: "*" is the only target it answers to.
      win.postMessage(type === "init" ? { type, code: widget.code, ...m } : { type, ...m }, "*")
    },
    [widget.code]
  )

  React.useEffect(() => {
    if (started.current) send("update")
    else if (message && ready.current) {
      started.current = true
      send("init")
    }
  }, [message, send])

  React.useEffect(() => {
    if (!tomoe) return
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const r = tomoe.SandboxMessage.safeParse(e.data)
      if (!r.success) return
      const m = r.data
      if (m.type === "ready") {
        ready.current = true
        if (started.current || !latest.current) return
        started.current = true
        send("init")
      } else if (m.type === "resize") setHeight(Math.min(SANDBOX_HEIGHT.max, Math.max(SANDBOX_HEIGHT.min, Math.ceil(m.height))))
      else if (m.type === "open") open(m.target.action, m.target.params)
      else if (m.type === "ask") {
        toast("The widget suggests a question", { id: `ask-${widget.id}`, description: m.question, action: { label: "Ask", onClick: () => askChat({ text: m.question }) } })
      } else setProblem(m.message === "unsupported" ? "This browser cannot run custom widgets." : m.message)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [tomoe, send, open, askChat, widget.id])

  if (navigated) return <Problem text="This widget tried to leave the sandbox and was stopped." />
  return (
    <div className="flex flex-col gap-2">
      <iframe
        ref={frame}
        src="/sandbox/widget.html"
        sandbox={SANDBOX_IFRAME.sandbox}
        referrerPolicy={SANDBOX_IFRAME.referrerPolicy}
        title={widget.title}
        className="block w-full border-0 bg-transparent"
        height={height}
        onLoad={() => {
          loads.current += 1
          if (loads.current > 1) setNavigated(true)
        }}
      />
      {problem && <Problem text={problem} />}
    </div>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="flex animate-shake items-start gap-2 rounded-lg border border-negative/25 bg-negative/[0.06] px-3 py-2 text-xs text-negative">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span className="error-underline min-w-0 pb-0.5 break-words">{text}</span>
    </p>
  )
}
