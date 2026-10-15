import { describe, expect, it } from "vitest"

import { answerWidgets, stripBlocks } from "../src/index.ts"
import { tomoe, widgetJson } from "./fixtures.ts"

const block = (v: unknown) => "```widget\n" + JSON.stringify(v) + "\n```"

describe("answer blocks", () => {
  it("hides blocks, also while they stream", () => {
    expect(stripBlocks("Here it is.\n\n" + block(widgetJson()))).toBe("Here it is.")
    expect(stripBlocks('Here it is.\n\n```widget\n{"id": "x", "ti')).toBe("Here it is.")
    expect(stripBlocks("Here it is.\n\n```wid")).toBe("Here it is.")
  })

  it("keeps valid proposals for the web chat and notes the rest", () => {
    const answer = "Two ideas.\n\n" + block(widgetJson()) + "\n" + block({ id: "bad", title: "Bad", spec: { root: "x", elements: {} } }) + "\n```widget\n{nope\n```"
    const web = tomoe.finish(answer, "preview")
    expect(answerWidgets(web, tomoe.parseWidget).map((w) => w.id)).toEqual(["orders-6-months"])
    expect(web).toContain('⚠️ Widget not valid: root "x" is not an element')
    expect(web).toContain("⚠️ Widget not valid: not JSON")
    const text = tomoe.finish(answer, "text")
    expect(text).not.toContain("```widget")
    expect(text).toContain("🧩 Widget proposed: Orders, 6 months")
  })

  it("keeps the confirm block for yes/no buttons", () => {
    expect(tomoe.finish("Switch to creative mode?\n\n```confirm\n```", "preview")).toBe("Switch to creative mode?\n\n```confirm\n```")
  })

  it("lets the last block with an id win", () => {
    const a = { ...widgetJson(), title: "First" }
    const b = { ...widgetJson(), title: "Second" }
    expect(answerWidgets(block(a) + block(b), tomoe.parseWidget).map((w) => w.title)).toEqual(["Second"])
  })
})
