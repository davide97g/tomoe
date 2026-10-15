---
name: tomoe-ready
description: Make a web app, service or API ready to integrate with Tomoe, the chat that designs dashboards and widgets on top of any app. Publishes /.well-known/tomoe.json, a Source Manifest of read-only sources, an OpenAPI document for the read endpoints, llms.txt and deep links into the UI, so Tomoe connects from a single URL without guessing. Use when the user asks to make their app "Tomoe-ready", integrate with Tomoe, expose their data for AI dashboards or generative UI, publish a tomoe manifest, or add llms.txt or an OpenAPI document for agents.
---

# Tomoe-ready

Tomoe connects to an app from one URL. Before any agent runs, it GETs a few well-known places on that origin. When it finds `/.well-known/tomoe.json` with a valid manifest, connecting is instant and exact. Without it, an agent has to guess from the website, the docs and the code.

Your job: add what Tomoe reads, read-only, without changing what the app does.

| What | Where | Why |
| --- | --- | --- |
| Discovery document | `/.well-known/tomoe.json` | Points to everything below. Schema: `references/tomoe.schema.json`. |
| Source Manifest | e.g. `/tomoe.manifest.json` (or inline in the document) | The exact sources, fields, roles, sensitivity and deep links. Schema: `references/manifest.schema.json`. |
| Read endpoints | `GET` list endpoints | Rows the widgets query. JSON, paginated, with ISO dates. |
| OpenAPI document | `/openapi.json`, plus `<link rel="service-desc">` | Lets agents and tools check the endpoints. |
| llms.txt | `/llms.txt` | What the app is and where its API lives, in plain words for agents. |

## Workflow

### 1. Survey the app

- Framework and router. Where API routes live. Whether an OpenAPI document is already generated.
- The entities people look at: lists, reports, existing dashboards, exports. They show which numbers matter.
- How requests are authenticated, and whether a read-only token or scope exists.
- The web UI's routes, for deep links ("open this order": `/orders/{id}`).
- Labels in the user's language (i18n files).

### 2. Read endpoints, one per entity worth charting

- `GET` only, returning a JSON array or `{ "data": [...] }` (also accepted: `items`, `results`, `rows`, `records`).
- Pagination: `?limit=&offset=`, `?page=&per_page=`, or a cursor returned as `next_cursor`. Default page size of 100 or more.
- Field names stable and flat (`customer_id`, not `customer.id`). Numbers as numbers. Dates as `YYYY-MM-DD` or ISO 8601 date-times. Enums as strings.
- Keep the app's existing auth. Prefer a read-only token or scope for Tomoe. Never add an unauthenticated endpoint for it.
- Never add write endpoints for Tomoe. It never calls them, even when documented.
- Reuse existing list endpoints when they already fit. Only add what is missing.

### 3. OpenAPI document

Generate it from the code rather than writing it by hand:

| Stack | Usual tool | Default path |
| --- | --- | --- |
| FastAPI | built in | `/openapi.json` |
| NestJS | `@nestjs/swagger` | set `/openapi.json` |
| Hono | `@hono/zod-openapi` | `app.doc("/openapi.json", …)` |
| Express, Next.js route handlers | `@asteasolutions/zod-to-openapi`, `next-openapi-gen` | `/openapi.json` |
| Django REST framework | `drf-spectacular` | `/api/schema/` |
| Spring | `springdoc-openapi` | `/v3/api-docs` |
| Rails | `rswag` | `/api-docs` |
| Laravel | `dedoc/scramble`, `l5-swagger` | `/docs/api.json` |

Describe at least the read endpoints Tomoe uses, with their response schemas, enum values and pagination parameters. Advertise the document from the web app's HTML head, and from a `Link` header if possible:

```html
<link rel="service-desc" type="application/json" href="/openapi.json">
```

### 4. The Source Manifest

Write `tomoe.manifest.json` against `references/manifest.schema.json`. The rules that matter:

- **Sources.** One per entity, at most 40. `origin` is `{"kind": "rest", "method": "GET", "path": "/api/orders", "pagination": "none" | "page" | "offset" | "cursor"}`. Paths are relative to `api` in tomoe.json. Set `key` (primary key), `time` (the default date field) and `maxRows` (at most 50 000).
- **Roles.** `id` is the primary key. `measure` is a number that can be summed. `dimension` groups rows (enums, categories, booleans). `time` is a date or date-time. `text` is free text, never grouped. `reference` is a key of another source (add a `relations` entry).
- **Enums.** Type `enum` with the real `values`.
- **Units.** `"unit": "currency:EUR"`, `"percent"` or `"seconds"`. Set `app.currency` and `app.locale`.
- **Sensitive.** `"sensitive": true` on money, people's names, emails, phones, addresses, document numbers, birth dates and free text. Tomoe masks these in privacy mode and hides them from widget code. When unsure, mark it sensitive.
- **Actions.** Navigate only: a UI path with `{placeholders}` filled from a row, e.g. `{"id": "open-order", "label": "Open order", "kind": "navigate", "target": "/orders/{id}", "source": "orders", "params": {"id": "id"}}`. Never an API write.
- **Labels** in the users' language. Short descriptions that say what a row is.
- **No data.** Field names, types and enum values only. Never copy rows or personal data into the manifest.

### 5. `/.well-known/tomoe.json`

Serve it as a static JSON file (public; it holds no data and no secrets):

```json
{
  "tomoe": 1,
  "name": "Example Shop",
  "description": "Orders, customers and products of the shop.",
  "api": "https://api.example.com",
  "openapi": "https://api.example.com/openapi.json",
  "manifest": "/tomoe.manifest.json",
  "app": "https://app.example.com",
  "llms": "/llms.txt",
  "auth": { "header": "Authorization", "scheme": "Bearer", "docs": "https://example.com/docs/api-tokens" }
}
```

- URLs may be relative to the document.
- `api` is the base of the manifest's REST paths. `app` is the base of navigate actions.
- `manifest` is a URL, or the manifest object inline.
- Add `"mcp": "https://example.com/mcp"` if the app runs an MCP server.
- Never put tokens in it. `auth` only says how to get one.

### 6. `/llms.txt`

Follow llmstxt.org: an H1 with the name, a one-paragraph summary as a blockquote, then sections of links.

```markdown
# Example Shop

> An online shop: orders, customers and products. Read-only API for dashboards at https://api.example.com (Bearer token, read scope).

## API
- [OpenAPI](https://api.example.com/openapi.json): every read endpoint, with pagination and enums
- [Tomoe discovery](https://example.com/.well-known/tomoe.json): sources and deep links for dashboards

## Docs
- [API tokens](https://example.com/docs/api-tokens): how to create a read-only token
```

### 7. Verify

```bash
curl -s https://example.com/.well-known/tomoe.json | jq .
curl -s https://example.com/llms.txt | head
curl -s https://api.example.com/openapi.json | jq '.paths | keys'
curl -s -H "Authorization: Bearer $TOKEN" "https://api.example.com/api/orders?limit=5" | jq .
npx -y ajv-cli validate --spec=draft2020 -s references/manifest.schema.json -d tomoe.manifest.json
```

Then in Tomoe: Connect, paste the site's URL, press **Test**. Every row should be green, and "Tomoe-ready" should list the manifest's sources. **Connect** then uses your manifest directly, without the discovery agent.

The JSON Schema checks the shape. Tomoe also checks cross-field rules on connect: the key and time fields exist, measures are numbers, time fields are dates, enums have values, and action params are fields of their source. It shows the first problem it finds.

## Rules

- Read-only, always. No new write paths, no weaker auth, no data in the manifest, the docs or the examples.
- Do not move or rename existing endpoints. Add alongside them.
- Keep tomoe.json, llms.txt, the manifest and the OpenAPI document in step: same paths, same field names.
- Tell the user what you added, which fields you marked sensitive, and how to create the read-only token.

## Done when

- [ ] `/.well-known/tomoe.json` answers with `"tomoe": 1` and points to the manifest, the API and the OpenAPI document.
- [ ] The manifest validates against `references/manifest.schema.json`. Every REST path answers `GET` with rows that carry the declared fields.
- [ ] `/openapi.json` (or the declared path) describes those endpoints. The HTML head has `rel="service-desc"`.
- [ ] `/llms.txt` exists.
- [ ] Sensitive fields are marked. Actions are navigate-only.
- [ ] Tomoe's Connect → Test shows the app as Tomoe-ready.
