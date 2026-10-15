/** A recheck's draft against the accepted manifest, as a short sheet: what comes, what goes, what changes. */
import type { Manifest } from "@tomoe/core"

import { cn } from "@/components/ui"
import { diffManifests } from "@/lib/manifest-diff"

export function DiffSummary({ before, after, className }: { before: Manifest | null | undefined; after: Manifest; className?: string }) {
  const d = diffManifests(before, after)
  if (d.same)
    return (
      <p className={cn("flex items-center gap-2 text-[13px] text-muted-foreground", className)}>
        <span className="size-1.5 rounded-full bg-foreground/50" />
        Same sources and fields as the accepted manifest.
      </p>
    )
  return (
    <div className={cn("stagger flex flex-col gap-2 text-[13px]", className)}>
      {d.added.map((s) => (
        <Line key={`+${s.id}`} sign="+" title={s.label} note="new source" />
      ))}
      {d.removed.map((s) => (
        <Line key={`-${s.id}`} sign="−" title={s.label} note="no longer found" tone="negative" />
      ))}
      {d.changed.map((s) => (
        <Line key={`~${s.id}`} sign="~" title={s.label} note={s.notes.join(" · ")} />
      ))}
      {(d.actions.added.length > 0 || d.actions.removed.length > 0) && (
        <Line sign="↗" title="Actions" note={[...d.actions.added.map((a) => `+ ${a}`), ...d.actions.removed.map((a) => `− ${a}`)].join(" · ")} />
      )}
    </div>
  )
}

function Line({ sign, title, note, tone }: { sign: string; title: string; note: string; tone?: "negative" }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2.5">
      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]", tone === "negative" ? "border-negative/40 text-negative" : "border-foreground/30")}>{sign}</span>
      <span className="shrink-0 font-medium">{title}</span>
      <span className="min-w-0 font-mono text-[11.5px] break-words text-muted-foreground">{note}</span>
    </div>
  )
}
