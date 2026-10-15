/**
 * One connected app as the server uses it: its record, the Tomoe built from its accepted manifest
 * (every schema, the prompt, the block pipeline) and its adapter. Rebuilt when the manifest changes.
 */
import { join } from "node:path"

import { type Board, type Context, createTomoe, type Row, type Tomoe } from "@tomoe/core"

import { Adapter } from "./adapter.ts"
import { type AppRecord, emptyManifest, Store } from "./store.ts"

export type Workspace = {
  id: string
  record: () => AppRecord
  tomoe: Tomoe
  adapter: Adapter
  /** The agent's working folder; attachments live in files/ under it. */
  cwd: string
  board: () => Board
  load: (raw: unknown) => Board
  /** Rows of the sources a query set needs, for evaluating it on the server (agent tools). */
  context: (sources: string[]) => Promise<{ ctx: Context; errors: Record<string, string> }>
}

export const today = () => new Date().toLocaleDateString("en-CA")

export class Workspaces {
  private cache = new Map<string, { key: string; ws: Workspace }>()

  readonly store: Store

  constructor(store: Store) {
    this.store = store
  }

  get(id: string): Workspace | null {
    const record = this.store.app(id)
    if (!record) return null
    const raw = this.store.manifest(id) ?? emptyManifest(record.name)
    const key = JSON.stringify(raw)
    const hit = this.cache.get(id)
    if (hit && hit.key === key) return hit.ws
    let tomoe: Tomoe
    try {
      tomoe = createTomoe(raw)
    } catch (e) {
      console.error(`app ${id}: ${(e as Error).message}; using an empty manifest`)
      tomoe = createTomoe(emptyManifest(record.name))
    }
    const adapter = new Adapter(
      () => this.store.app(id)?.connection ?? { headers: {}, files: [] },
      (source) => this.store.memoryRows(id, source)
    )
    const load = (b: unknown) => tomoe.loadBoard(b, (w, why) => console.warn(`app ${id}: widget ${w} skipped: ${why}`))
    const ws: Workspace = {
      id,
      record: () => this.store.app(id) ?? record,
      tomoe,
      adapter,
      cwd: join(this.store.dir(id), "workspace"),
      board: () => load(this.store.rawBoard(id)),
      load,
      context: async (sources) => {
        const rows: Record<string, Row[] | null> = {}
        const errors: Record<string, string> = {}
        await Promise.all(
          [...new Set(sources)].map(async (s) => {
            const r = await adapter.rows(tomoe.manifest, s)
            rows[s] = r.rows
            if (r.error) errors[s] = r.error
          })
        )
        return { ctx: { manifest: tomoe.manifest, today: today(), rows: (s) => rows[s] ?? null }, errors }
      },
    }
    this.cache.set(id, { key, ws })
    return ws
  }

  forget(id: string) {
    this.cache.delete(id)
  }
}
