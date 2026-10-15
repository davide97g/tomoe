import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/components/ui"

/** Markdown from the agent or a widget: links open outside, no raw HTML. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("prose-chat min-w-0 break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
