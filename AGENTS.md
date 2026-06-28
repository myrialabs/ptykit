# Agent Guidelines

This file is for coding agents working in the **ptykit** repository.

## Project Snapshot

ptykit is a TypeScript ESM library that serves PTY (pseudoterminal) sessions over
WebSocket for Node 18+ and Bun, plus a framework-agnostic browser client and a
Svelte adapter. Its behavior is hardened against real-world collaborative
terminal usage.

Development uses Bun for scripts and tests. `bun-pty` is the tested PTY backend;
`node-pty` is an experimental Node path.

## Core Rules

- **WebSocket only.** Never reintroduce SSE or a `transport` option.
- Keep `src/` cross-runtime (Node 18+, Bun). The PTY backend is selected by
  runtime auto-detect via dynamic `import()`; gate `Bun.*` / `node:*` behind
  feature checks with a portable fallback.
- `bun-pty` is the default/tested backend; `node-pty` stays **experimental**
  (typed and documented as such) until the scale and auto-detect benchmarks gate it.
- Output persists to the headless terminal first (even with zero listeners);
  reattach replays a **serialized** frame, not raw bytes; clear old listeners
  before attaching new ones.
- Preserve the collaborative room model (output broadcast to a room, filtered
  client-side by `sessionId`; N clients ↔ 1 session).
- The library core stays silent — no stdout/stderr writes; route diagnostics
  through the injectable logger.
- Use explicit `.js` import specifiers. Keep strict TypeScript and ESLint intact.
- Do not revert or overwrite unrelated user changes.
- Update public docs when public behavior changes.

## Repository Map

- `src/index.ts` — main entry (`ptykit`): core engine + WebSocket server barrel.
- `src/core/` — `PtyKit` session manager, `PtyBackend` + bun-pty/node-pty
  adapters, output pipeline (seq/batching/fan-out), scrollback serialize,
  reattach, lifecycle.
- `src/server/` — `createPtyKitServer`: WS transport, rooms/broadcast,
  `authorize`, RPC + events (Bun.serve & Node http.Server).
- `src/client/index.ts` — `ptykit/client`: `PtyKitClient`, `attachFit`,
  reconnect/heal, persistence hook.
- `src/client/svelte/` — `ptykit/svelte`: `<PtyTerminal/>` adapter.
- `src/shared/` — wire-protocol types, `seq`, `stripReportRequests`.
- `docs/*.md` — api, server, client, svelte.
- `examples/` — runnable scenarios (Node/Bun) + `browser/` xterm wiring.
- `bench/` — benchmark harness; results in `bench-results.md`.

## Style

- TypeScript strict. Tabs, single quotes, semicolons. `const` by default.
- `camelCase` values, `PascalCase` types/classes, `UPPER_SNAKE_CASE` constants,
  `kebab-case` files.
- `any` only at the runtime boundary.
- Focused comments that explain non-obvious behavior.

## Testing And Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun test src/core/session.test.ts   # targeted
```

Add `*.test.ts` next to non-trivial logic: idempotent create, seq dedup, env
hygiene, kill semantics, serialize-replay, authorize allow/deny + anti-hijack,
room fan-out, reconnect/heal, fit debounce.

## Documentation Rules

- Public API changes: update `README.md` and `docs/api.md`.
- Server/client/adapter changes: update the matching `docs/*.md`.
- Example-affecting changes: update `examples/` or its README.
- Do not create new Markdown files unless requested or clearly needed.

## Contribution Metadata

Follow `CONTRIBUTING.md` for branch names, commit messages, PR titles, and PR
descriptions. Repository-facing text must be in English.
