import { describe, expect, it } from "vitest"

import { COMPONENT_TYPES } from "../src/index.ts"
import { tomoe } from "./fixtures.ts"

describe("agent instructions", () => {
  const text = tomoe.instructions()

  it("describe every component, source, field and action", () => {
    for (const type of COMPONENT_TYPES) expect(text).toContain(`- ${type} {`)
    for (const s of tomoe.manifest.sources) {
      expect(text).toContain(`"${s.id}"`)
      for (const f of s.fields) expect(text).toContain(`${f.name} (`)
    }
    for (const a of tomoe.manifest.actions) expect(text).toContain(`"${a.id}"`)
  })

  it("leave creative mode out on request", () => {
    expect(text).toContain("Creative mode")
    expect(tomoe.instructions({ creative: false })).not.toContain("Creative mode")
  })
})
