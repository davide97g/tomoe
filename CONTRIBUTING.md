# Contributing to Tomoe

Thanks for helping. Issues, ideas and pull requests are all welcome.

## Set up

Requirements: Node 24, pnpm (the version in `package.json`), and Claude Code if you want to run the chat and the discovery agent.

```
pnpm install
pnpm dev                 # web on :5173, server on :8791
pnpm example:server      # a made-up, Tomoe-ready shop on :8792
pnpm typecheck && pnpm test
```

## Before you open a pull request

- `pnpm typecheck && pnpm test` pass. Add a test for what you change.
- Read the section of `skills/tomoe/references/blueprint.md` your change touches, and update it when behaviour changes.
- Follow the conventions in `AGENTS.md`: TypeScript run by Node directly (erasable syntax only, `.ts` extensions in relative imports), Zod for every shape, error messages written for the LLM (name the path, the rule and what is allowed), English everywhere.
- Changing the manifest or `/.well-known/tomoe.json` schemas: run `pnpm schema` to regenerate `skills/tomoe-ready/references/*.schema.json`.
- Editing the sandbox page's script: update its hash (see `packages/core/test/sandbox.test.ts`).

## Security-sensitive changes

The agents are read-only, the sandbox has three walls, and privacy is applied to the data. Do not loosen any of these without saying so in the pull request and explaining why. See the list in `AGENTS.md` and `SECURITY.md`.

## Data

Only made-up data in code, tests, examples, docs, screenshots and commits. Never real names, emails, amounts, tokens or URLs of private systems.

## License

By contributing you agree that your contributions are licensed under the MIT License (`LICENSE`).
