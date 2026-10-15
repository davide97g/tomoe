/**
 * Tomoe core: from a Source Manifest to every schema the chat, the server and the clients share.
 *
 *   const t = createTomoe(manifest)
 *   t.instructions()              // the agent's widget prompt
 *   t.parseWidget(json)           // { widget } | { error } for a proposal or a save
 *   t.finish(answer, "preview")   // the server's pass over a finished answer
 */
import { buildCatalog, type Catalog } from "./catalog.ts"
import { finishAnswer, renderAnswer } from "./blocks.ts"
import { type Manifest, type ManifestInput, parseManifest } from "./manifest.ts"
import { instructions } from "./prompt.ts"
import { buildQueries, type Queries } from "./query.ts"
import { buildSandboxMessage } from "./sandbox.ts"
import { buildWidgets, loadBoard, type Widgets } from "./widget.ts"

export * from "./blocks.ts"
export * from "./catalog.ts"
export * from "./evaluate.ts"
export * from "./manifest.ts"
export * from "./prompt.ts"
export * from "./query.ts"
export * from "./sandbox.ts"
export * from "./wellknown.ts"
export * from "./widget.ts"

export type Tomoe = Queries &
  Widgets & {
    manifest: Manifest
    catalog: Catalog
    SandboxMessage: ReturnType<typeof buildSandboxMessage>
    instructions: (options?: { creative?: boolean }) => string
    finish: (answer: string, channel: "preview" | "text") => string
    loadBoard: (raw: unknown, report?: (id: string, why: string) => void) => ReturnType<typeof loadBoard>
  }

export function createTomoe(input: ManifestInput | unknown): Tomoe {
  const parsed = parseManifest(input)
  if ("error" in parsed) throw new Error(`manifest: ${parsed.error}`)
  const manifest = parsed.manifest
  const queries = buildQueries(manifest)
  const catalog = buildCatalog(manifest, queries)
  const widgets = buildWidgets(catalog, queries)
  return {
    manifest,
    catalog,
    ...queries,
    ...widgets,
    SandboxMessage: buildSandboxMessage(manifest),
    instructions: (options) => instructions(manifest, catalog, options),
    finish: (answer, channel) => renderAnswer(finishAnswer(answer, widgets.parseWidget), channel),
    loadBoard: (raw, report) => loadBoard(raw, widgets.Widget, report),
  }
}
