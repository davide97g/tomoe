/** What a new manifest (a draft from a recheck) changes against the accepted one, in short lines. */
import type { Manifest } from "@tomoe/core"

type Source = Manifest["sources"][number]
type Field = Source["fields"][number]

export type SourceChange = { id: string; label: string; notes: string[] }
export type ManifestDiff = {
  added: { id: string; label: string }[]
  removed: { id: string; label: string }[]
  changed: SourceChange[]
  actions: { added: string[]; removed: string[] }
  same: boolean
}

const origin = (s: Source) => (s.origin.kind === "rest" ? `GET ${s.origin.path}` : s.origin.kind === "memory" ? "stored rows" : s.origin.kind)

function fieldNotes(a: Field, b: Field): string[] {
  const out: string[] = []
  if (a.type !== b.type) out.push(`${b.name}: type ${a.type} → ${b.type}`)
  if (a.role !== b.role) out.push(`${b.name}: role ${a.role} → ${b.role}`)
  if (!!a.sensitive !== !!b.sensitive) out.push(`${b.name}: ${b.sensitive ? "now sensitive" : "no longer sensitive"}`)
  if (a.label !== b.label) out.push(`${b.name}: label “${a.label}” → “${b.label}”`)
  return out
}

export function diffManifests(before: Manifest | null | undefined, after: Manifest): ManifestDiff {
  const old = new Map((before?.sources ?? []).map((s) => [s.id, s]))
  const now = new Map(after.sources.map((s) => [s.id, s]))
  const added = after.sources.filter((s) => !old.has(s.id)).map((s) => ({ id: s.id, label: s.label }))
  const removed = (before?.sources ?? []).filter((s) => !now.has(s.id)).map((s) => ({ id: s.id, label: s.label }))
  const changed: SourceChange[] = []
  for (const b of after.sources) {
    const a = old.get(b.id)
    if (!a) continue
    const notes: string[] = []
    if (origin(a) !== origin(b)) notes.push(`read from ${origin(a)} → ${origin(b)}`)
    const af = new Map(a.fields.map((f) => [f.name, f]))
    const bf = new Map(b.fields.map((f) => [f.name, f]))
    for (const f of b.fields) if (!af.has(f.name)) notes.push(`+ ${f.name}`)
    for (const f of a.fields) if (!bf.has(f.name)) notes.push(`− ${f.name}`)
    for (const f of b.fields) {
      const prev = af.get(f.name)
      if (prev) notes.push(...fieldNotes(prev, f))
    }
    if (a.label !== b.label) notes.push(`renamed “${a.label}” → “${b.label}”`)
    if (notes.length) changed.push({ id: b.id, label: b.label, notes })
  }
  const oldActions = new Set((before?.actions ?? []).map((x) => x.id))
  const newActions = new Set(after.actions.map((x) => x.id))
  const actions = { added: [...newActions].filter((x) => !oldActions.has(x)), removed: [...oldActions].filter((x) => !newActions.has(x)) }
  return { added, removed, changed, actions, same: !added.length && !removed.length && !changed.length && !actions.added.length && !actions.removed.length }
}
