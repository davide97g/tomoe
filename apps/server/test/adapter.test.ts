import { describe, expect, it } from "vitest"

import { sendHeaders } from "../src/adapter.ts"

describe("sendHeaders", () => {
  it("puts Bearer in front of a bare Authorization token and leaves the rest alone", () => {
    expect(sendHeaders({ Authorization: "abc123" })).toEqual({ Authorization: "Bearer abc123" })
    expect(sendHeaders({ authorization: " abc123 " })).toEqual({ authorization: "Bearer abc123" })
    expect(sendHeaders({ Authorization: "Bearer abc123" })).toEqual({ Authorization: "Bearer abc123" })
    expect(sendHeaders({ Authorization: "Basic dXNlcjpwdw==" })).toEqual({ Authorization: "Basic dXNlcjpwdw==" })
    expect(sendHeaders({ "X-Api-Key": "abc123" })).toEqual({ "X-Api-Key": "abc123" })
  })
})
