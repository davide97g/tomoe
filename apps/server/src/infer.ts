/**
 * A data file (CSV or JSON) the user attached, turned into a "memory" source without the LLM: field
 * types, roles and sensitivity guessed from the header and the values, for the user to review like any
 * other manifest draft. Sensitive when unsure (names, contacts, money, free text).
 */
import type { Field, Row, Source } from "@tomoe/core"

import { rowsOf } from "./adapter.ts"

const MAX_ROWS = 50_000

/** RFC 4180-ish: quoted fields, doubled quotes, commas or semicolons (whichever the header uses more). */
export function parseCsv(text: string): Row[] {
  const clean = text.replace(/^﻿/, "")
  const firstLine = clean.slice(0, clean.indexOf("\n") >>> 0)
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ","
  const records: string[][] = []
  let field = ""
  let record: string[] = []
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === "") quoted = true
    else if (c === sep) {
      record.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++
      record.push(field)
      field = ""
      if (record.some((f) => f !== "")) records.push(record)
      record = []
      if (records.length > MAX_ROWS) break
    } else field += c
  }
  if (field !== "" || record.length) {
    record.push(field)
    if (record.some((f) => f !== "")) records.push(record)
  }
  const [header, ...body] = records
  if (!header) return []
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])))
}

const SENSITIVE = /name|email|e_mail|phone|mobile|address|street|city|zip|postal|iban|account|card|tax|vat|ssn|fiscal|passport|birth|dob|note|comment|description|message|amount|price|total|cost|salary|revenue|balance|income|paid|payment/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const NUMBER = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/

function fieldName(header: string, used: Set<string>): string {
  let n = header
    .normalize("NFKD")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 60)
  if (!n || /^\d/.test(n)) n = `f_${n}`
  let name = n
  for (let i = 2; used.has(name); i++) name = `${n}_${i}`
  used.add(name)
  return name
}

function guess(header: string, name: string, values: unknown[], total: number): Omit<Field, "name" | "label"> {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "")
  const strings = present.map((v) => (typeof v === "string" ? v.trim() : v))
  const all = (test: (v: unknown) => boolean) => strings.length > 0 && strings.every(test)
  const sensitive = SENSITIVE.test(header)
  if (all((v) => typeof v === "boolean" || v === "true" || v === "false")) return { type: "boolean", role: "dimension", sensitive: false }
  if (all((v) => typeof v === "string" && DATE.test(v))) return { type: "date", role: "time", sensitive: /birth|dob/i.test(header) }
  if (all((v) => typeof v === "string" && DATETIME.test(v))) return { type: "datetime", role: "time", sensitive: false }
  if (all((v) => typeof v === "number" || (typeof v === "string" && NUMBER.test(v)))) {
    const nums = strings.map((v) => (typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))))
    const integer = nums.every(Number.isInteger)
    if (/(^|_)(id|year|code|zip)$/i.test(name)) return { type: integer ? "integer" : "number", role: /id$/i.test(name) ? "reference" : "dimension", sensitive }
    return { type: integer ? "integer" : "number", role: "measure", sensitive }
  }
  const distinct = new Set(strings.map(String))
  const long = strings.reduce<number>((n, v) => n + String(v).length, 0) / Math.max(1, strings.length) > 40
  if (/(^|_)id$/i.test(name)) return { type: "string", role: distinct.size === present.length ? "id" : "reference", sensitive: false }
  if (!long && distinct.size <= 12 && distinct.size >= 1 && total >= distinct.size * 2 && [...distinct].every((v) => v.length <= 80)) {
    return { type: "enum", role: "dimension", values: [...distinct].sort(), sensitive }
  }
  return { type: "string", role: long || sensitive || distinct.size > total * 0.8 ? "text" : "dimension", sensitive: sensitive || long }
}

/** A source and its rows from a file's text; an error when there is no table in it. */
export function inferSource(fileName: string, text: string, taken: string[]): { source: Source; rows: Row[] } | { error: string } {
  let raw: Row[] | null
  if (/\.json$/i.test(fileName)) {
    try {
      raw = rowsOf(JSON.parse(text))
    } catch {
      return { error: "the file is not valid JSON" }
    }
  } else raw = parseCsv(text)
  if (!raw?.length) return { error: "no rows found in the file (expected a CSV with a header, or a JSON list of objects)" }
  raw = raw.slice(0, MAX_ROWS)
  const headers = [...new Set(raw.slice(0, 200).flatMap((r) => Object.keys(r)))].slice(0, 79)
  const used = new Set<string>(["_row"])
  const fields: Field[] = headers.map((h) => {
    const name = fieldName(h, used)
    return { name, label: h.trim().slice(0, 80) || name, ...guess(h, name, raw!.slice(0, 2000).map((r) => r[h]), Math.min(raw!.length, 2000)) } as Field
  })
  const names = new Map(headers.map((h, i) => [h, fields[i].name]))
  let key = fields.find((f) => f.role === "id")?.name
  if (!key) {
    fields.unshift({ name: "_row", label: "Row", type: "integer", role: "id", sensitive: false })
    key = "_row"
  }
  const base = fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 30) || "data"
  let id = base
  for (let i = 2; taken.includes(id); i++) id = `${base}_${i}`
  const rows = raw.map((r, i) => {
    const out: Row = key === "_row" ? { _row: i + 1 } : {}
    for (const [h, n] of names) out[n] = r[h] ?? null
    return out
  })
  const time = fields.find((f) => f.role === "time")?.name
  const source = {
    id,
    label: fileName.replace(/\.[^.]+$/, "").slice(0, 80) || id,
    description: `Imported from ${fileName.slice(0, 200)} (${rows.length} rows).`,
    origin: { kind: "memory" as const },
    key,
    ...(time ? { time } : {}),
    fields,
    relations: [],
    maxRows: Math.min(50_000, Math.max(rows.length, 1)),
  }
  return { source, rows }
}
