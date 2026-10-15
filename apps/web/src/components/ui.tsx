/** Small primitives on the theme's tokens: buttons, badges, a gauge, a dialog, the Tomoe mark. */
import * as React from "react"
import { XIcon } from "lucide-react"

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ")

const VARIANT = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/88 hover:shadow-soft",
  secondary: "bg-muted text-foreground hover:bg-border/70",
  ghost: "text-foreground hover:bg-muted",
  outline: "border border-foreground/20 bg-card/70 text-foreground hover:border-foreground/60 hover:bg-card",
  danger: "text-negative hover:bg-negative/10",
} as const
const SIZE = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-[13px]",
  md: "h-10 gap-2 rounded-full px-4 text-sm",
  icon: "size-9 rounded-full",
  "icon-sm": "size-8 rounded-full",
} as const

type Ripple = { id: number; x: number; y: number; d: number }

/** Ink ripples from the pointer on press; returns the handler and the drops to render. */
export function useRipples() {
  const [drops, setDrops] = React.useState<Ripple[]>([])
  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const d = Math.hypot(r.width, r.height) * 2
    setDrops((ds) => [...ds.slice(-3), { id: e.timeStamp, x: e.clientX - r.left, y: e.clientY - r.top, d }])
  }, [])
  const node = drops.map((r) => (
    <span key={r.id} className="ripple" style={{ left: r.x, top: r.y, width: r.d, height: r.d }} onAnimationEnd={() => setDrops((ds) => ds.filter((x) => x.id !== r.id))} />
  ))
  return { onPointerDown, node }
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  onPointerDown,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE }) {
  const ripples = useRipples()
  return (
    <button
      type="button"
      className={cn(
        "relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out select-none active:scale-[0.96] active:duration-75 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANT[variant],
        SIZE[size],
        className
      )}
      onPointerDown={(e) => {
        ripples.onPointerDown(e)
        onPointerDown?.(e)
      }}
      {...props}
    >
      {children}
      {ripples.node}
    </button>
  )
}

export function Badge({ className, tone = "muted", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "muted" | "primary" | "accent" | "outline" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    primary: "bg-foreground text-background",
    accent: "bg-accent/35 text-foreground",
    outline: "border border-foreground/25 text-muted-foreground",
  }
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[10.5px] font-medium tracking-[0.06em] whitespace-nowrap", tones[tone], className)} {...props} />
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-foreground/20 bg-card px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
}

/** A tracked uppercase label, optionally with the short rule under it. */
export function Label({ children, className, rule }: { children: React.ReactNode; className?: string; rule?: boolean }) {
  return (
    <span className={cn("flex flex-col gap-2", className)}>
      <span className="label-caps">{children}</span>
      {rule && <span className="rule-draw w-6!" />}
    </span>
  )
}

/** An outlined track with an ink fill. Without `value` it runs (indeterminate). */
export function Gauge({ value, className }: { value?: number; className?: string }) {
  const [shown, setShown] = React.useState(0)
  // Fill from empty on mount, so a value arrives as a motion.
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value ?? 0))
    return () => cancelAnimationFrame(id)
  }, [value])
  return (
    <span
      className={cn("gauge block h-2.5", className)}
      data-indeterminate={value === undefined ? "" : undefined}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value)}
    >
      <i style={value === undefined ? undefined : { width: `calc(${Math.max(0, Math.min(100, shown))}% - 3px)` }} />
    </span>
  )
}

/** Done: a ring and a check drawn in one stroke, with a burst of ink dots. */
export function DoneCheck({ className, burst = true }: { className?: string; burst?: boolean }) {
  return (
    <span className={cn("relative inline-flex size-4 shrink-0", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="check-draw size-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10.5" strokeWidth="1.3" />
        <path d="M7.5 12.5l3 3 6-6.5" />
      </svg>
      {burst && (
        <span className="burst">
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <i key={a} style={{ "--a": `${a}deg` } as React.CSSProperties} />
          ))}
        </span>
      )}
    </span>
  )
}

const COMMAS = [
  "M50.00 4.00A46 46 0 0 0 4.70 57.99A40 40 0 0 1 50.00 36.00A16 16 0 1 0 50.00 4.00Z",
  "M89.84 73.00A46 46 0 0 0 65.73 6.77A40 40 0 0 1 62.12 57.00A16 16 0 1 0 89.84 73.00Z",
  "M10.16 73.00A46 46 0 0 0 79.57 85.24A40 40 0 0 1 37.88 57.00A16 16 0 1 0 10.16 73.00Z",
]

/** Mitsudomoe: three commas chasing each other. It turns while the agent works. */
export function TomoeMark({ className, working, accent }: { className?: string; working?: boolean; accent?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn(working && "tomoe-working", className)}>
      {COMMAS.map((d, i) => (
        <path key={d} d={d} fill="currentColor" opacity={accent && i !== 0 ? 0.42 : 1} />
      ))}
    </svg>
  )
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}) {
  const ref = React.useRef<HTMLDialogElement>(null)
  // Closed by the user (Esc, the backdrop): tell the parent. Closed because `open` turned false (another
  // dialog took over): nothing to tell, or the parent would close the next dialog too.
  const wanted = React.useRef(open)
  wanted.current = open
  React.useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={() => wanted.current && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-auto max-h-[min(88vh,900px)] w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-[#111111]/25 backdrop:backdrop-blur-[3px] open:animate-[dialog-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] open:backdrop:animate-fade",
        wide ? "max-w-3xl" : "max-w-lg"
      )}
    >
      {open && (
        <div className="flex max-h-[min(88vh,900px)] flex-col">
          <header className="flex items-start gap-3 border-b px-6 pt-5 pb-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="rule-draw w-6!" />
              <h2 className="font-display text-lg font-medium tracking-tight">{title}</h2>
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="[&_svg]:transition-transform hover:[&_svg]:rotate-90">
              <XIcon />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label-caps">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export const inputClass =
  "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 hover:border-foreground/30 focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-foreground/6"
