/** Tomoe server: API, agent runs on the user's Claude subscription, sandbox page, web client. */
import { serve } from "@hono/node-server"

import { createApp, services } from "./app.ts"
import { loadConfig } from "./config.ts"

const config = loadConfig()
const s = services(config)

serve({ fetch: createApp(s).fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`tomoe on http://${info.address}:${info.port} (data: ${config.data})`)
  if (!config.claude) console.log("claude not found in PATH: the chat and the discovery are off (install Claude Code and log in)")
})
