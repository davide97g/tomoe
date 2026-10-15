/**
 * The agent's fenced blocks (references/blueprint.md §6.3). The agent never writes the board: it ends
 * its answer with blocks the server validates.
 *
 * ```widget
 * {"id": "orders-6-months", "title": "Orders", "size": "medium", "spec": {...}}
 * ```
 * ```confirm
 * ```
 * An empty confirm block marks an answer that asks a yes/no question (creative mode); the client shows buttons.
 */
import { type WidgetInput, widgetJson } from "./widget.ts"

const WIDGET = /```widget[ \t]*\n([\s\S]*?)```/g
const CONFIRM = /```confirm[^\n`]*\n?[^`]*```/g
export const CONFIRM_BLOCK = "```confirm\n```"
// While streaming: a block that has started but not ended yet, or a fence name still being typed.
const OPEN = /```(?:widget|confirm)[\s\S]*$/
const FENCE_START = /```[a-z]*$/

/** Widget blocks in an answer, as written (unchecked JSON; null when unreadable). */
export function widgetBlocks(answer: string): unknown[] {
  return [...answer.matchAll(WIDGET)].map((m) => {
    try {
      return JSON.parse(m[1])
    } catch {
      return null
    }
  })
}

/** The text to show: blocks removed, also mid-stream (an unfinished block is hidden too). */
export function stripBlocks(answer: string): string {
  return answer.replace(WIDGET, "").replace(CONFIRM, "").replace(OPEN, "").replace(FENCE_START, "").trimEnd()
}

export function asksToConfirm(answer: string): boolean {
  return answer.match(CONFIRM) !== null
}

export function widgetBlock(w: WidgetInput): string {
  return "```widget\n" + widgetJson(w) + "\n```"
}

export const MAX_PROPOSALS = 3

export type Finished = { text: string; widgets: WidgetInput[]; problems: string[]; confirm: boolean }

/**
 * The server's pass over a finished answer: at most MAX_PROPOSALS widgets, each validated; problems
 * are written for the agent (or the user re-asking) to fix. `render` gives the stored answer for a
 * channel: blocks normalized for a client that previews them, one line each for one that cannot.
 */
export function finishAnswer(answer: string, parse: (v: unknown) => { widget: WidgetInput } | { error: string }): Finished {
  const widgets: WidgetInput[] = []
  const problems: string[] = []
  for (const v of widgetBlocks(answer).slice(0, MAX_PROPOSALS)) {
    const r = v === null ? { error: "not JSON" } : parse(v)
    if ("error" in r) problems.push(r.error)
    else widgets.push(r.widget)
  }
  return { text: stripBlocks(answer), widgets, problems, confirm: asksToConfirm(answer) }
}

export function renderAnswer(f: Finished, channel: "preview" | "text", lines = { bad: (why: string) => `⚠️ Widget not valid: ${why}`, elsewhere: (title: string) => `🧩 Widget proposed: ${title}. Open the app to see it.` }): string {
  const blocks = channel === "preview" ? f.widgets.map(widgetBlock) : []
  const notes = [...f.problems.map(lines.bad), ...(channel === "text" ? f.widgets.map((w) => lines.elsewhere(w.title)) : [])]
  return [f.text, ...blocks, f.confirm ? CONFIRM_BLOCK : "", notes.join("\n")].filter(Boolean).join("\n\n")
}

/**
 * The widgets a stored or live answer proposes, one per id: the last one wins (a live answer holds the
 * agent's block and then the server's normalized copy).
 */
export function answerWidgets(answer: string, parse: (v: unknown) => { widget: WidgetInput } | { error: string }): WidgetInput[] {
  const byId = new Map<string, WidgetInput>()
  for (const v of widgetBlocks(answer)) {
    const r = parse(v)
    if ("widget" in r) {
      byId.delete(r.widget.id)
      byId.set(r.widget.id, r.widget)
    }
  }
  return [...byId.values()]
}
