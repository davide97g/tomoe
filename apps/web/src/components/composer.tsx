/**
 * Where the user asks: text, attachments (picked, pasted or dropped: screenshots, sketches, PDFs, data
 * files) and links, which the server opens for the agent (images are saved so it can see them).
 */
import * as React from "react"
import { ArrowUpIcon, DatabaseIcon, FileIcon, ImageIcon, LinkIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button, cn, Gauge, useRipples } from "@/components/ui"
import { api, type ChatFile } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

type Pending = { key: string; name: string; preview?: string; file?: ChatFile; error?: string }

const LINK = /https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g
const DATA = /\.(csv|tsv|json)$/i

/** `setText(t, true)` types the text in, a few characters at a time (instant with reduced motion). */
export type ComposerHandle = { focus: () => void; setText: (t: string, typed?: boolean) => void; addFiles: (files: File[]) => void }

export const Composer = React.forwardRef<
  ComposerHandle,
  { busy: boolean; onSend: (text: string, files: ChatFile[]) => void; onStop: () => void; big?: boolean; placeholder?: string }
>(function Composer({ busy, onSend, onStop, big, placeholder }, ref) {
  const { app, reloadDetail, setDialog } = useWorkspace()
  const [text, setText] = React.useState("")
  const [files, setFiles] = React.useState<Pending[]>([])
  const area = React.useRef<HTMLTextAreaElement>(null)
  const picker = React.useRef<HTMLInputElement>(null)
  const typing = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const [flash, setFlash] = React.useState(0)
  const uploading = files.some((f) => !f.file && !f.error)
  const links = React.useMemo(() => [...new Set(text.match(LINK) ?? [])].slice(0, 4), [text])

  const addFiles = React.useCallback(
    async (list: File[]) => {
      if (!app || !list.length) return
      const items: Pending[] = list.slice(0, 10).map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined }))
      setFiles((fs) => [...fs, ...items].slice(-10))
      try {
        const saved = await api.upload(app.id, list.slice(0, 10))
        setFiles((fs) => fs.map((f) => (items.some((i) => i.key === f.key) ? { ...f, file: saved[items.findIndex((i) => i.key === f.key)] } : f)))
      } catch (e) {
        setFiles((fs) => fs.map((f) => (items.some((i) => i.key === f.key) ? { ...f, error: (e as Error).message } : f)))
      }
    },
    [app]
  )

  const put = React.useCallback((t: string, typed?: boolean) => {
    clearInterval(typing.current)
    setFlash((n) => n + 1)
    if (!typed || !t || matchMedia("(prefers-reduced-motion: reduce)").matches) return setText(t)
    let i = 0
    const step = Math.max(1, Math.ceil(t.length / 28))
    typing.current = setInterval(() => {
      i = Math.min(t.length, i + step)
      setText(t.slice(0, i))
      if (i >= t.length) clearInterval(typing.current)
    }, 16)
  }, [])
  React.useEffect(() => () => clearInterval(typing.current), [])

  React.useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), setText: put, addFiles: (f) => void addFiles(f) }), [addFiles, put])

  // Grow with the text, up to a point.
  React.useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, big ? 280 : 220)}px`
  }, [text, big])

  const submit = () => {
    const ready = files.filter((f) => f.file).map((f) => f.file!)
    if (busy || uploading || (!text.trim() && !ready.length)) return
    onSend(text.trim(), ready)
    setText("")
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview))
    setFiles([])
  }

  const importData = async (f: ChatFile) => {
    if (!app) return
    try {
      await api.dataFile(app.id, f.path)
      await reloadDetail()
      setDialog({ kind: "review" })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div
      className={cn(
        "group/composer relative flex flex-col rounded-2xl border border-foreground/15 bg-card shadow-soft transition-[border-color,box-shadow,transform] duration-300 ease-out hover:border-foreground/30 focus-within:border-foreground/70 focus-within:shadow-[0_0_0_5px_color-mix(in_oklab,var(--foreground)_5%,transparent),var(--shadow)]",
        big && "rounded-[1.4rem]"
      )}
    >
      {flash > 0 && <span key={flash} className="pointer-events-none absolute inset-0 animate-[composer-flash_900ms_ease-out_both] rounded-[inherit] border border-foreground" aria-hidden />}
      {(files.length > 0 || links.length > 0) && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {files.map((f) => (
            <div key={f.key} className={cn("group/file relative flex h-14 max-w-60 animate-pop items-center gap-2 overflow-hidden rounded-lg border bg-background pr-2", f.error && "animate-shake border-negative/50")}>
              {f.preview ? <img src={f.preview} alt="" className="h-full w-14 shrink-0 object-cover" /> : <span className="flex h-full w-12 shrink-0 items-center justify-center bg-muted">{DATA.test(f.name) ? <DatabaseIcon className="size-4" /> : <FileIcon className="size-4" />}</span>}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium">{f.name}</span>
                {!f.file && !f.error ? (
                  <Gauge className="mt-1 h-1.5! w-20" />
                ) : (
                  <span className={cn("text-[11px]", f.error ? "error-underline text-negative" : "text-muted-foreground")}>{f.error ?? (DATA.test(f.name) ? "" : f.preview ? "image" : "attached")}</span>
                )}
                {f.file && DATA.test(f.name) && (
                  <button type="button" className="cursor-pointer self-start text-[11px] font-medium underline decoration-accent underline-offset-2 hover:decoration-foreground" onClick={() => void importData(f.file!)}>
                    Use as data
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity group-hover/file:opacity-100 focus-visible:opacity-100"
                onClick={() => setFiles((fs) => fs.filter((x) => x.key !== f.key))}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
          {links.map((l) => (
            <span key={l} className="flex h-7 max-w-72 animate-pop items-center gap-1.5 self-center rounded-full border border-foreground/25 pr-1 pl-2.5 text-xs">
              {/\.(png|jpe?g|gif|webp)(\?|$)/i.test(l) ? <ImageIcon className="size-3.5 shrink-0" /> : <LinkIcon className="size-3.5 shrink-0" />}
              <span className="truncate">{l.replace(/^https?:\/\//, "")}</span>
              {!/\.(png|jpe?g|gif|webp)(\?|$)/i.test(l) && (
                <button type="button" title="Connect this app: Tomoe reads its llms.txt, OpenAPI, MCP and website" className="ml-1 h-5 cursor-pointer rounded-full bg-foreground px-2 text-[10px] font-medium text-background transition-transform hover:scale-105 active:scale-95" onClick={() => setDialog({ kind: "connect", url: l })}>
                  Connect
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={area}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = [...e.clipboardData.files]
          if (pasted.length) {
            e.preventDefault()
            void addFiles(pasted)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={placeholder ?? "Ask for a view, a chart, a whole dashboard…"}
        aria-label="Message"
        className={cn(
          "w-full resize-none bg-transparent px-4 outline-none transition-[min-height] duration-300 ease-out placeholder:text-muted-foreground/70 placeholder:transition-opacity focus:placeholder:opacity-60 focus-visible:outline-none",
          big ? "min-h-16 pt-4.5 text-base focus:min-h-22" : "min-h-12 pt-3.5 text-[15px] focus:min-h-14"
        )}
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept="image/*,.pdf,.csv,.tsv,.json,.txt,.md,.html,.css,.svg"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])])
            e.target.value = ""
          }}
        />
        <Button variant="ghost" size="icon-sm" onClick={() => picker.current?.click()} aria-label="Attach files" title="Attach a screenshot, a sketch, a PDF or a data file" className="hover:[&_svg]:-rotate-12 [&_svg]:transition-transform">
          <PaperclipIcon />
        </Button>
        <span className="ml-1 hidden text-xs text-muted-foreground transition-opacity group-focus-within/composer:opacity-100 sm:inline sm:opacity-70">Drop a screenshot, paste a link, or attach a CSV</span>
        <div className="flex-1" />
        <SendButton busy={busy} ready={!uploading && (!!text.trim() || files.some((f) => f.file))} onSend={submit} onStop={onStop} />
      </div>
    </div>
  )
})

/** One button, three states: empty (outlined), ready (ink, the arrow lifts), busy (a stop square in a turning ring). */
function SendButton({ busy, ready, onSend, onStop }: { busy: boolean; ready: boolean; onSend: () => void; onStop: () => void }) {
  const ripples = useRipples()
  const state = busy ? "busy" : ready ? "ready" : "empty"
  return (
    <button
      type="button"
      onClick={busy ? onStop : onSend}
      onPointerDown={ripples.onPointerDown}
      disabled={state === "empty"}
      aria-label={busy ? "Stop" : "Send"}
      title={busy ? "Stop (Esc)" : "Send (Enter)"}
      data-state={state}
      className={cn(
        "group/send relative isolate flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border transition-[background-color,border-color,color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-90 active:duration-75 disabled:cursor-default",
        state === "empty" && "border-foreground/20 text-muted-foreground",
        state === "ready" && "scale-105 border-foreground bg-foreground text-background shadow-soft hover:scale-110",
        state === "busy" && "border-transparent bg-muted text-foreground"
      )}
    >
      {busy && (
        <svg viewBox="0 0 36 36" className="absolute inset-0 size-full animate-[spin_1.1s_linear_infinite]" aria-hidden>
          <circle cx="18" cy="18" r="16.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="26 80" strokeLinecap="round" />
        </svg>
      )}
      <ArrowUpIcon className={cn("absolute size-4 transition-all duration-300", busy ? "translate-y-3 scale-50 opacity-0" : "group-hover/send:-translate-y-0.5")} />
      <SquareIcon className={cn("absolute size-3 fill-current transition-all duration-300", busy ? "scale-100 opacity-100" : "scale-0 opacity-0")} />
      {ripples.node}
    </button>
  )
}
