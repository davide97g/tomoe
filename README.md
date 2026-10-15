# Tomoe

A chat that designs dashboards and widgets on top of any app.

Tomoe looks at an app (its API, database or MCP server), writes down what it can attach to in a **Source Manifest**, and lets a chat agent design widgets on that data: declarative specs from a component catalog first, free code in a sandbox ("creative mode") when the catalog is not enough. Widgets hold queries, never data; the agent is read-only; the user adds what they like.

Distilled from the Board of [Autocratico](../autocratico) (generative UI and the custom-widget sandbox, October 2026).

## Layout

- `skills/tomoe/` — the agent skill (`SKILL.md`) and the full spec, `references/blueprint.md` (also at `docs/blueprint.md`).
- `skills/tomoe-ready/` — the skill for *your* app: makes it ready to connect (`/.well-known/tomoe.json`, a manifest, OpenAPI, `llms.txt`). Install it in your app's repo with `npx skills add davide97g/tomoe --skill tomoe-ready`, then ask your agent "Make this app Tomoe-ready".
- `packages/core/` — reference implementation: manifest, query DSL generated from it, evaluation, component catalog, widget specs, chat blocks, agent prompt, sandbox page and its CSP. See its README.
- `apps/server/` — the chat server (Hono, Node 24): runs Claude Code headless (`claude -p`) on your own Claude subscription, as Autocratico does; gives the agent read-only MCP tools on the data; reads the host (GET only); keeps apps, boards (with Undo) and chats under `var/`.
- `apps/web/` — the web client (Vite, React, Tailwind v4): a full-screen chat that docks beside the board, live widget previews, the sandbox frame, connect/discover/review dialogs.
- `examples/shop/` — a made-up shop: manifest, rows, a widget, seeded data (`data.ts`) and a read-only API with an OpenAPI document (`server.ts`).

## Commands

```
pnpm install
pnpm dev                 # web on http://127.0.0.1:5173, server on :8791 (started by Vite)
pnpm build && pnpm start # one process on http://127.0.0.1:8791
pnpm example:server      # the made-up shop on :8792, Tomoe-ready (EXAMPLE_PLAIN=1: API only, to watch the discovery agent)
pnpm schema              # regenerate the JSON Schemas in skills/tomoe-ready/references
pnpm typecheck && pnpm test
pnpm example
```

Requirements: Node 24, pnpm, and [Claude Code](https://claude.com/claude-code) logged in with your subscription (`claude`, then `/login`). Data goes to `var/` (or `TOMOE_DATA`). The server listens on loopback only.

## Using it

- **Ask.** The chat opens full screen. Describe a view, drop or paste a screenshot or a sketch, attach a PDF, or paste a link (images are fetched for the agent; pages it may open with WebFetch, on that domain only). Widget blocks become live previews; nothing reaches the board until you press Add.
- **Connect from a URL.** Paste a website, web app or API and press **Test**: Tomoe looks for `/.well-known/tomoe.json`, `llms.txt`, OpenAPI/Swagger documents (also behind `rel="service-desc"` links), MCP server cards, GraphQL, robots and sitemap, and fills in the API fields. Add screenshots of the app, a repo folder, an auth header if you have them. A Tomoe-ready app publishes its own manifest and connects without any agent; otherwise the discovery agent reads the website (its own domain only), the docs, the screenshots and the code, probes the API (GET, small limits) and drafts a Source Manifest that a deterministic probe checks. You review roles and sensitivity and accept. Or load the example shop, or turn a CSV/JSON into a source ("Use as data"). Links pasted in the chat get a **Connect** button too.
- **Board.** Opening it docks the chat on the right; every add, update, move or removal can be undone. "Ask for a change" on a widget opens the chat about it.
- **Creative mode.** When components are not enough (or there is no data yet: the Playground), the agent asks first, writes code, and you press "Run in sandbox" before it runs.

Keys: `B` board, `P` privacy, `Esc` stop the answer.

## Status

Built and tested: core and sandbox, chat server and agent (on the Claude subscription), REST and "memory" (data file) adapters, discovery with probe and review, web client (renderer, proposals, board with Undo, sandbox frame). Recon on a URL and the tomoe-ready path: built and tested. Not built yet: GraphQL, SQL and MCP adapters (recon reports them, rows cannot be read yet); drift detection; the exfiltration battery re-run against this web client (blueprint §7.3) before anyone else uses creative mode.
