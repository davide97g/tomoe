/**
 * Copy, the cat: frame-by-frame sprite sheets (public/mascot/, one grid per animation plus
 * manifest.json) played with requestAnimationFrame. The mood comes from useMascot() unless one is
 * passed; a click makes Copy jump. With `roam`, Copy strolls along a track of that width while idle.
 *
 * The cat stands on the bottom edge of a `size` px box (1.3x as wide, for the tail and whiskers); jumps
 * overflow upwards.
 */
import * as React from "react"

import { cn } from "@/components/ui"
import { type MascotAnimation, type MascotSheet, useMascot } from "@/lib/mascot"

export type MascotProps = {
  /** Height of the cat's box, in px (the cat fills it, feet on the bottom edge). */
  size?: number
  /** Plays this animation instead of the shared mood (e.g. "walk" in an empty state). */
  mood?: MascotAnimation
  /** Shows the mood under the cat, in the concept-sheet label style. */
  label?: boolean
  /** Width in px of a track Copy walks along while idle; the cat stays put without it. */
  roam?: number
  className?: string
}

const BASE = "/mascot/"
/** Where the cat sits inside a sprite cell (fractions of the cell): its resting height and the ground line. */
const CAT_HEIGHT = 186 / 320
const GROUND = 306 / 320

let manifest: Promise<MascotSheet> | null = null
const loadManifest = () =>
  (manifest ??= fetch(`${BASE}manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<MascotSheet>) : {}))
    .catch(() => ({})))

const images = new Map<string, Promise<void>>()
const loadImage = (name: string) => {
  let p = images.get(name)
  if (!p) {
    const img = new Image()
    img.src = `${BASE}${name}.webp`
    p = img.decode().catch(() => {})
    images.set(name, p)
  }
  return p
}

function useSheets() {
  const [sheets, setSheets] = React.useState<MascotSheet | null>(null)
  React.useEffect(() => {
    let live = true
    void loadManifest().then((m) => {
      if (!live) return
      setSheets(m)
      // The resting animations first, the rest when the browser is idle.
      void Promise.all([loadImage("idle"), loadImage("think")]).then(() => {
        const rest = () => Object.keys(m).forEach((n) => void loadImage(n))
        if ("requestIdleCallback" in window) requestIdleCallback(rest)
        else setTimeout(rest, 300)
      })
    })
    return () => {
      live = false
    }
  }, [])
  return sheets
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** Plays one animation of the sheet in a box; switches only once the next sheet is decoded (no blank frame). */
function Sprite({ sheets, want, size, flip }: { sheets: MascotSheet; want: MascotAnimation; size: number; flip: boolean }) {
  const [shown, setShown] = React.useState<MascotAnimation | null>(null)
  const el = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let live = true
    if (!sheets[want]) return
    void loadImage(want).then(() => live && setShown(want))
    return () => {
      live = false
    }
  }, [sheets, want])

  const sheet = shown ? sheets[shown] : undefined
  const cell = (size * 0.92) / CAT_HEIGHT // a cell big enough that the resting cat fills `size`
  const scale = cell / (sheet?.cellWidth ?? 1)

  React.useEffect(() => {
    const node = el.current
    if (!sheet || !node || !shown) return
    const columns = sheet.columns ?? sheet.frames
    const place = (i: number) => {
      node.style.backgroundPosition = `${-(i % columns) * cell}px ${-Math.floor(i / columns) * cell}px`
    }
    if (reducedMotion()) {
      place(sheet.loop ? 0 : sheet.frames - 1)
      return
    }
    let raf = 0
    let last = -1
    const start = performance.now()
    const tick = (now: number) => {
      const n = Math.floor(((now - start) * sheet.fps) / 1000)
      const i = sheet.loop ? n % sheet.frames : Math.min(n, sheet.frames - 1)
      if (i !== last) place((last = i))
      if (sheet.loop || n < sheet.frames) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sheet, shown, cell])

  if (!sheet || !shown) return null
  const columns = sheet.columns ?? sheet.frames
  const rows = Math.ceil(sheet.frames / columns)
  return (
    <div
      ref={el}
      aria-hidden
      className="pointer-events-none absolute left-1/2 bg-no-repeat"
      style={{
        width: cell,
        height: cell,
        top: size - cell * GROUND,
        marginLeft: -cell / 2,
        backgroundImage: `url(${BASE}${shown}.webp)`,
        backgroundSize: `${columns * sheet.cellWidth * scale}px ${rows * sheet.cellHeight * scale}px`,
        transform: flip ? "scaleX(-1)" : undefined,
      }}
    />
  )
}

/** Walks the cat to a new spot along the track now and then, only while it is idle. */
function useRoam(track: number | undefined, size: number, idle: boolean) {
  const [walking, setWalking] = React.useState(false)
  const [flip, setFlip] = React.useState(false)
  const x = React.useRef(0)
  const el = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!track || !idle || reducedMotion()) return
    const span = Math.max(0, track - size)
    let raf = 0
    let timer: ReturnType<typeof setTimeout>
    const stroll = () => {
      const from = x.current
      let to = (Math.random() - 0.5) * span
      if (Math.abs(to - from) < size * 0.6) to = from > 0 ? from - size : from + size
      to = Math.max(-span / 2, Math.min(span / 2, to))
      const speed = size * 0.8 // px per second, about one stride per walk cycle
      const duration = (Math.abs(to - from) / speed) * 1000
      setFlip(to < from)
      setWalking(true)
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        x.current = from + (to - from) * t
        if (el.current) el.current.style.transform = `translateX(${x.current}px)`
        if (t < 1) raf = requestAnimationFrame(step)
        else {
          setWalking(false)
          timer = setTimeout(stroll, 7000 + Math.random() * 9000)
        }
      }
      raf = requestAnimationFrame(step)
    }
    timer = setTimeout(stroll, 4000 + Math.random() * 4000)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      setWalking(false)
    }
  }, [track, size, idle])

  return { walking, flip, el }
}

export function Mascot({ size = 56, mood, label = true, roam, className }: MascotProps) {
  const shared = useMascot()
  const sheets = useSheets()
  const base: MascotAnimation = mood ?? (shared.shot === "jump" ? "jump" : shared.mood)
  const { walking, flip, el } = useRoam(roam, size, base === "idle")
  const current: MascotAnimation = walking ? "walk" : base
  const small = size < 40

  return (
    <div className={cn("relative flex shrink-0 justify-center", className)} style={{ width: roam ?? Math.round(size * 1.3) }}>
      <div ref={el} className="flex flex-col items-center will-change-transform">
        <button
          type="button"
          aria-label={`Copy the cat, ${current}. Press to make it jump`}
          data-mood={current}
          onClick={() => shared.trigger("jump")}
          className="relative cursor-pointer rounded-full outline-offset-4 transition-transform duration-150 active:scale-95"
          style={{ width: size, height: size }}
        >
          {sheets && <Sprite sheets={sheets} want={sheets[current] ? current : "idle"} size={size} flip={flip && current === "walk"} />}
          {current === "sleep" && !small && (
            <span aria-hidden className="absolute -top-2 right-0 animate-[mascot-z_2.4s_ease-in-out_infinite] font-display text-[11px] text-muted-foreground">
              z
            </span>
          )}
        </button>
        {label && !small && (
          <span key={current} className="mt-2 animate-fade label-caps text-[9px]! tracking-[0.3em]!">
            {current}
          </span>
        )}
      </div>
    </div>
  )
}
