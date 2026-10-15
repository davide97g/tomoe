import { spawn, type ChildProcess } from "node:child_process"
import { resolve } from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const API_PORT = Number(process.env.PORT ?? 8791)

// In development, also start the API server (apps/server) on loopback.
function apiServer(): Plugin {
  let child: ChildProcess | undefined
  return {
    name: "tomoe-api-server",
    apply: "serve",
    configureServer() {
      child = spawn(process.execPath, ["--watch", resolve(import.meta.dirname, "../server/src/main.ts")], { stdio: "inherit", env: { ...process.env, PORT: String(API_PORT) } })
      const stop = () => child?.kill()
      process.once("exit", stop)
      process.once("SIGINT", () => {
        stop()
        process.exit()
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), mode !== "test" && !process.env.TOMOE_NO_API && apiServer()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: { "/api": `http://127.0.0.1:${API_PORT}`, "/sandbox": `http://127.0.0.1:${API_PORT}` },
  },
}))
