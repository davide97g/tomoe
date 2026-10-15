/**
 * Copy the cat's mood, derived from what the app is doing. The sprite player (src/components/mascot.tsx)
 * reads it; nothing else depends on it.
 *
 * Priority: a one-shot mood (success, error) while it lasts, then "think" while anything works, then
 * "sleep" after a stretch with no activity, then "idle".
 */
import * as React from "react"

export type MascotMood = "idle" | "think" | "success" | "error" | "sleep"
/** Every animation the sprite sheets hold; "walk" and "jump" are played by components, not by moods. */
export type MascotAnimation = MascotMood | "walk" | "jump"
/** The sprite strips' manifest.json: one entry per animation. */
export type MascotSheet = Partial<Record<MascotAnimation, { frames: number; fps: number; cellWidth: number; cellHeight: number; columns?: number; loop: boolean }>>

type OneShot = { mood: "success" | "error" | "jump"; until: number }

type Mascot = {
  mood: MascotMood
  /** A one-shot animation, e.g. "jump" when something lands; the mood returns after it. */
  shot: OneShot["mood"] | null
  /** Plays a one-shot mood for `ms` (default: 1.8 s). */
  trigger: (mood: OneShot["mood"], ms?: number) => void
  /** Marks a named piece of work as running or done; the mood is "think" while any runs. */
  setWorking: (key: string, on: boolean) => void
}

const DURATION = { success: 1800, error: 1800, jump: 1800 } as const
const Ctx = React.createContext<Mascot | null>(null)

export function MascotProvider({ children, sleepAfter = 60_000 }: { children: React.ReactNode; sleepAfter?: number }) {
  const [shot, setShot] = React.useState<OneShot | null>(null)
  const [working, setWorkingKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [asleep, setAsleep] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Any input wakes the cat up and restarts the countdown to sleep.
  React.useEffect(() => {
    const arm = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setAsleep(true), sleepAfter)
    }
    const wake = () => {
      setAsleep(false)
      arm()
    }
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "focusin"] as const
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    arm()
    return () => {
      clearTimeout(timer.current)
      events.forEach((e) => window.removeEventListener(e, wake))
    }
  }, [sleepAfter])

  React.useEffect(() => {
    if (!shot) return
    const t = setTimeout(() => setShot(null), Math.max(0, shot.until - Date.now()))
    return () => clearTimeout(t)
  }, [shot])

  const trigger = React.useCallback((mood: OneShot["mood"], ms?: number) => {
    setAsleep(false)
    setShot({ mood, until: Date.now() + (ms ?? DURATION[mood]) })
  }, [])

  const setWorking = React.useCallback((key: string, on: boolean) => {
    setWorkingKeys((prev) => {
      if (prev.has(key) === on) return prev
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
    if (on) setAsleep(false)
  }, [])

  const mood: MascotMood = shot && shot.mood !== "jump" ? shot.mood : working.size ? "think" : asleep ? "sleep" : "idle"
  const value = React.useMemo<Mascot>(() => ({ mood, shot: shot?.mood ?? null, trigger, setWorking }), [mood, shot, trigger, setWorking])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const NOOP: Mascot = { mood: "idle", shot: null, trigger: () => {}, setWorking: () => {} }

/** The whole mascot state: mood, the current one-shot, and the triggers. Works outside the provider (no-op). */
export function useMascot(): Mascot {
  return React.useContext(Ctx) ?? NOOP
}

/** The current mood only. */
export function useMascotMood(): MascotMood {
  return useMascot().mood
}

/** "think" while `busy`; when it turns false, success or error once, by `failed`. */
export function useMascotWork(key: string, busy: boolean, failed?: boolean) {
  const { setWorking, trigger } = useMascot()
  const was = React.useRef(busy)
  React.useEffect(() => {
    setWorking(key, busy)
    if (was.current && !busy) trigger(failed ? "error" : "success")
    was.current = busy
  }, [key, busy, failed, setWorking, trigger])
  React.useEffect(() => () => setWorking(key, false), [key, setWorking])
}
