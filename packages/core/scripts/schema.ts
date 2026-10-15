// Writes the JSON Schemas of the Source Manifest and of /.well-known/tomoe.json for apps that publish their own manifest (the tomoe-ready
// skill). The Zod schema in src/manifest.ts is the source; test/schema.test.ts fails when this is stale.
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { manifestJsonSchema } from "../src/manifest.ts"
import { tomoeDocumentJsonSchema } from "../src/wellknown.ts"

const DIR = resolve(import.meta.dirname, "../../../skills/tomoe-ready/references")
export const SCHEMAS: Record<string, () => Record<string, unknown>> = {
  [resolve(DIR, "manifest.schema.json")]: manifestJsonSchema,
  [resolve(DIR, "tomoe.schema.json")]: tomoeDocumentJsonSchema,
}

if (process.argv[1] === import.meta.filename) {
  for (const [file, make] of Object.entries(SCHEMAS)) {
    writeFileSync(file, JSON.stringify(make(), null, 2) + "\n")
    console.log(`wrote ${file}`)
  }
}
