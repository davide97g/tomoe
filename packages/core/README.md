# @tomoe/core

From a Source Manifest to every schema Tomoe's chat, server and clients share.

```ts
import { createTomoe, series, value } from "@tomoe/core"

const tomoe = createTomoe(manifest)          // throws with the first problem, written for the agent
tomoe.instructions()                         // the chat agent's widget prompt (catalog + sources + creative mode)
tomoe.finish(answer, "preview")              // server pass over an answer: blocks validated, normalized, problems noted
tomoe.parseWidget(body)                      // { widget } | { error }, for a save request
tomoe.loadBoard(raw, report)                 // stored board, invalid widgets skipped
tomoe.SandboxMessage.safeParse(event.data)   // what the sandbox frame may ask
value(metric.value, ctx); series(chart.series, ctx); customData(widget.data, ctx, privacy)
```

`ctx` is `{ manifest, today, rows: (sourceId) => Row[] | null }`: the rows an adapter fetched (capped by `maxRows`); `null` means the source is not available, shown as such, never as zero.

The sandbox page is `sandbox/widget.html`; serve it with `SANDBOX_HEADERS` and embed it with `SANDBOX_IFRAME`.
