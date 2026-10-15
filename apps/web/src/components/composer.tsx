/**
 * Where the user asks: text, attachments (picked, pasted or dropped: screenshots, sketches, PDFs, data
 * files) and links, which the server opens for the agent (images are saved so it can see them).
 */
import * as React from "react"
import { ArrowUpIcon, DatabaseIcon, FileIcon, ImageIcon, LinkIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button, cn, TomoeMark } from "@/components/ui"
import { api, type ChatFile } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

type Pending = { key: string; name: string; preview?: string; file?: ChatFile; error?: string }

const LINK = /https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g
const DATA = /\.(csv|tsv|json)$/i

export type ComposerHandle = { focus: () => void; setText: (t: string) => void; addFiles: (files: File[]) => void }

export const Composer = React.forwardRef<
  ComposerHandle,
  { busy: boolean; onSend: (text: string, files: ChatFile[]) => void; onStop: () => void; big?: boolean; placeholder?: string }
>(function Composer({ busy, onSend, onStop, big, placeholder }, ref) {
  const { app, reloadDetail, setDialog } = useWorkspace()
  const [text, setText] = React.useState("")
  const [files, setFiles] = React.useState<Pending[]>([])
  const area = React.useRef<HTMLTextAreaElement>(null)
  const picker = React.useRef<HTMLInputElement>(null)
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

  React.useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), setText: (t) => setText(t), addFiles: (f) => void addFiles(f) }), [addFiles])

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
        "group/composer relative flex flex-col rounded-2xl border bg-card shadow-soft transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_10%,transparent),var(--shadow)]",
        big && "rounded-[1.25rem]"
      )}
    >
      {(files.length > 0 || links.length > 0) && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {files.map((f) => (
            <div key={f.key} className={cn("group/file relative flex h-14 max-w-60 items-center gap-2 overflow-hidden rounded-lg border bg-background pr-2", f.error && "border-negative/50")}>
              {f.preview ? <img src={f.preview} alt="" className="h-full w-14 shrink-0 object-cover" /> : <span className="flex h-full w-12 shrink-0 items-center justify-center bg-muted">{DATA.test(f.name) ? <DatabaseIcon className="size-4" /> : <FileIcon className="size-4" />}</span>}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium">{f.name}</span>
                <span className={cn("text-[11px]", f.error ? "text-negative" : "text-muted-foreground")}>
                  {f.error ?? (f.file ? (DATA.test(f.name) ? "" : f.preview ? "image" : "attached") : "uploading…")}
                </span>
                {f.file && DATA.test(f.name) && (
                  <button type="button" className="cursor-pointer self-start text-[11px] font-medium text-primary hover:underline" onClick={() => void importData(f.file!)}>
                    Use as data
                  </button>
                )}
              </div>
              {!f.file && !f.error && <TomoeMark working className="absolute top-1 right-1 size-3 text-primary" />}
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
            <span key={l} className="flex h-7 max-w-72 items-center gap-1.5 self-center rounded-full bg-primary/8 px-2.5 text-xs text-primary">
              {/\.(png|jpe?g|gif|webp)(\?|$)/i.test(l) ? <ImageIcon className="size-3.5 shrink-0" /> : <LinkIcon className="size-3.5 shrink-0" />}
              <span className="truncate">{l.replace(/^https?:\/\//, "")}</span>
              {!/\.(png|jpe?g|gif|webp)(\?|$)/i.test(l) && (
                <button type="button" title="Connect this app: Tomoe reads its llms.txt, OpenAPI, MCP and website" className="ml-1 cursor-pointer rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground hover:brightness-110" onClick={() => setDialog({ kind: "connect", url: l })}>
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
        className={cn("w-full resize-none bg-transparent px-4 outline-none placeholder:text-muted-foreground/70 focus-visible:outline-none", big ? "min-h-16 pt-4 text-base" : "min-h-12 pt-3.5 text-[15px]")}
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
        <Button variant="ghost" size="icon-sm" onClick={() => picker.current?.click()} aria-label="Attach files" title="Attach a screenshot, a sketch, a PDF or a data file">
          <PaperclipIcon />
        </Button>
        <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">Drop a screenshot, paste a link, or attach a CSV</span>
        <div className="flex-1" />
        {busy ? (
          <Button variant="secondary" size="icon-sm" onClick={onStop} aria-label="Stop">
            <SquareIcon className="fill-current" />
          </Button>
        ) : (
          <Button variant="primary" size="icon-sm" onClick={submit} disabled={uploading || (!text.trim() && !files.some((f) => f.file))} aria-label="Send">
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </div>
  )
})
