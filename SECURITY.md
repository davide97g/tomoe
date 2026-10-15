# Security policy

Tomoe runs agents and agent-written code next to people's data, so security reports are very welcome.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Include what you did, what happened, and what you expected. You will get an answer as soon as possible; fixes are credited unless you prefer otherwise.

## What is in scope

- An agent writing, sending data out, or reaching origins or files it should not (tool profile in `apps/server/src/claude.ts`, the `http_get` origin check, the MCP tools' masking).
- Custom widget code escaping the sandbox: reaching the network, the host page, cookies or storage, or navigating away (`packages/core/sandbox/widget.html`, `SANDBOX_CSP`).
- Sensitive fields reaching widget code in privacy mode.
- The server answering requests from other hosts or origins, or serving files outside an app's attachments.
- Secrets (connection headers) reaching the browser, the agent or the sandbox.

## Design notes

Tomoe is meant to run on your own machine and listens on 127.0.0.1 only. Exposing it on a network needs authentication in front of it, which it does not provide. The threat model and the checklist are in `skills/tomoe/references/blueprint.md` (§7 and §9).
