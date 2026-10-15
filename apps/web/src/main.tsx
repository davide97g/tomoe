import { createRoot } from "react-dom/client"

import { App } from "@/App"

import "./index.css"

// No StrictMode: its double effects would abort the streams the chat and the discovery open on mount.
createRoot(document.getElementById("root")!).render(<App />)
