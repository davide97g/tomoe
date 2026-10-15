/** Small primitives on the theme's tokens: buttons, badges, a dialog, the Tomoe mark. */
import * as React from "react"
import { XIcon } from "lucide-react"

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ")

const VARIANT = {
  primary: "bg-primary text-primary-foreground hover:brightness-110 shadow-soft",
  secondary: "bg-muted text-foreground hover:bg-border/70",
  ghost: "text-foreground hover:bg-muted",
  outline: "border bg-card text-foreground hover:bg-muted",
  danger: "text-negative hover:bg-negative/10",
} as const
const SIZE = {
  sm: "h-8 gap-1.5 rounded-md px-2.5 text-[13px]",
  md: "h-10 gap-2 rounded-lg px-3.5 text-sm",
  icon: "size-9 rounded-lg",
  "icon-sm": "size-8 rounded-md",
} as const

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-[background,filter,color,transform] select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...props}
    />
  )
}

export function Badge({ className, tone = "muted", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "muted" | "primary" | "kihada" | "outline" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    primary: "bg-primary/12 text-primary",
    kihada: "bg-kihada/20 text-foreground",
    outline: "border text-muted-foreground",
  }
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium tracking-wide whitespace-nowrap", tones[tone], className)} {...props} />
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-card px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
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
        <path key={d} d={d} fill={accent && i === 0 ? "var(--kihada)" : "currentColor"} />
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
        "m-auto max-h-[min(88vh,900px)] w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-[#0b1020]/45 backdrop:backdrop-blur-[2px] open:animate-rise",
        wide ? "max-w-3xl" : "max-w-lg"
      )}
    >
      {open && (
        <div className="flex max-h-[min(88vh,900px)] flex-col">
          <header className="flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
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
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export const inputClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/15"
