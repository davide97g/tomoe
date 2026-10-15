/**
 * /.well-known/tomoe.json: what a Tomoe-ready app says about itself (skills/tomoe-ready). Read by the
 * server's recon before any agent runs; with a valid manifest in it, connecting needs no discovery.
 * URLs may be relative to the document.
 */
import { z } from "zod"

export const TOMOE_WELL_KNOWN = "/.well-known/tomoe.json"

export const TomoeDocument = z
  .object({
    tomoe: z.literal(1),
    name: z.string().max(80).optional(),
    description: z.string().max(1000).optional(),
    /** Base URL of the read-only API the manifest's REST paths are relative to. */
    api: z.string().max(500).optional(),
    /** The API's OpenAPI document. */
    openapi: z.string().max(500).optional(),
    /** The Source Manifest, inline or by URL. */
    manifest: z.union([z.string().max(500), z.record(z.string(), z.unknown())]).optional(),
    /** Base URL of the web UI: navigate actions open paths under it. */
    app: z.string().max(500).optional(),
    llms: z.string().max(500).optional(),
    mcp: z.string().max(500).optional(),
    /** How to authenticate read requests: the header to send, and where to get a read-only token. */
    auth: z.object({ header: z.string().max(60).optional(), scheme: z.string().max(40).optional(), docs: z.string().max(500).optional() }).optional(),
  })
  .passthrough()
export type TomoeDocument = z.infer<typeof TomoeDocument>

export function tomoeDocumentJsonSchema(): Record<string, unknown> {
  return { title: "Tomoe discovery document (/.well-known/tomoe.json)", ...z.toJSONSchema(TomoeDocument, { io: "input", unrepresentable: "any" }) }
}
