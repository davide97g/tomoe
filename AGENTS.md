# Tomoe

A chat that designs dashboards and widgets on top of any app (`README.md`). The spec is `skills/tomoe/references/blueprint.md`; read the sections a task needs before changing behaviour, and update it when behaviour changes.

## Layout
- `packages/core/src/`: `manifest.ts` (Source Manifest, action paths), `query.ts` (query DSL generated per manifest), `evaluate.ts` (running queries over fetched rows, rows for custom code), `catalog.ts` (components: props schema + prompt line side by side), `widget.ts` (spec and custom widgets, code pre-check, board load), `blocks.ts` (```widget / ```confirm blocks in answers), `prompt.ts` (agent instructions from catalog + manifest), `sandbox.ts` (CSP, headers, frame messages), `wellknown.ts` (`/.well-known/tomoe.json`), `index.ts` (`createTomoe`). `scripts/schema.ts` writes the JSON Schemas into `skills/tomoe-ready/references` (`pnpm schema`; a test fails when stale).
- `packages/core/sandbox/widget.html`: the sandbox page (sanitizer, worker prelude with the `ac` API, protocol).
- `apps/server/src/`: `claude.ts` (`claude -p` runner and the tool profiles: the agents' security boundary), `mcp.ts` (stdio MCP server the agent calls for data), `agent.ts` (prompts, discovery, tool answers), `recon.ts` (deterministic look at a URL: tomoe.json, llms.txt, OpenAPI, MCP, GraphQL), `adapter.ts` (host reads: GET only, origin-pinned), `infer.ts` (CSV/JSON to a source), `store.ts` (files under `var/`), `workspace.ts`, `app.ts` (routes, local-only guards).
- `apps/web/src/`: `lib/workspace.tsx` (state), `lib/chat.ts`, `components/` (chat, composer, proposal, widget-view renderer, sandbox-frame, board, connect).
- `design/mascot/`: sources of Copy, the cat (`apps/web/src/components/mascot.tsx`); `tools/pack.py` rebuilds `apps/web/public/mascot/` (see its README).
- `examples/`: made-up data only. `skills/tomoe/`: the agent skill. `skills/tomoe-ready/`: the skill host apps install (skills.sh) to publish what Tomoe reads.

## Conventions
- TypeScript run by Node 24 directly: erasable syntax only (no enums, no parameter properties), `.ts` extensions in relative imports. Zod 4 for every shape.
- Error messages are for the LLM: name the path, the rule and what is allowed.
- Code, comments, docs and commits in English.
- Checks: `pnpm typecheck && pnpm test`.

## Security-sensitive (do not loosen without saying so)
- Agents are read-only; manifest origins are GET/query only; actions are navigate-only, and the host builds paths itself (`actionPath`).
- Agent runs (`apps/server/src/claude.ts`): `--setting-sources ""` and `--strict-mcp-config` (no user or repo hooks, settings, MCP servers); built-in tools limited to Read/Glob/Grep (+ WebFetch pinned to the domains the user typed, chat only); Bash/Edit/Write denied; the app's own JSON files and secrets-looking paths denied. Data only through Tomoe's MCP tools, which mask sensitive values and need the per-process token.
- The server listens on 127.0.0.1, refuses other Host headers and cross-origin writes.
- Discovery reads only the app's own origins (website, API, OpenAPI document): `http_get` checks the origin, WebFetch is pinned to those domains, auth headers go to the API origin only, no web search.
- Sandbox: iframe `sandbox="allow-scripts"` without `allow-same-origin`; code only in a Web Worker; HTML sanitized; `SANDBOX_CSP` allows only the page's script by hash and no connection. Editing the page's script means updating the hash (`test/sandbox.test.ts`).
- Privacy at the data layer: sensitive fields are null for custom code in privacy mode.
- No real data in code, examples, docs or commits.
