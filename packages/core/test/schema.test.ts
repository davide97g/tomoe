// The published JSON Schemas (skills/tomoe-ready) follow the Zod schemas: `pnpm schema` rewrites it.
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { SCHEMAS } from "../scripts/schema.ts"

describe("published JSON Schemas", () => {
  it("are up to date (run pnpm schema)", () => {
    for (const [file, make] of Object.entries(SCHEMAS)) expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(make())
  })
})
