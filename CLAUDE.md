# Claude Code Guidelines

Guidelines for Claude Code when working on **ptykit**.

---

## What This Project Is

ptykit is a TypeScript-native library that serves **PTY sessions over WebSocket**
for Node 18+ and Bun, with a framework-agnostic browser client and a Svelte
adapter. Its design is hardened against real-world collaborative terminal usage
rather than assembled from assumptions.

- `ptykit` — core session engine (`PtyKit`) + WebSocket server
  (`createPtyKitServer`).
- `ptykit/client` — browser client (`PtyKitClient`, `attachFit`) with
  reconnect/heal.
- `ptykit/svelte` — `<PtyTerminal/>` adapter.

The package ships ESM (`NodeNext`) from `src/` to `dist/`. The PTY backend is an
optional dependency resolved at runtime: `bun-pty` on Bun (tested), `node-pty` on
Node (experimental).

Three properties are **binding**: WebSocket-only transport, the collaborative
room model (N clients ↔ 1 session), and serialized-scrollback reattach. Don't
weaken them without a measured reason.

---

## Non-Negotiables

- **WebSocket only.** No SSE, no `transport` option in the public API.
- Keep `src/` cross-runtime (Node 18+, Bun). Select the PTY backend by runtime
  auto-detect via dynamic `import()`; gate `Bun.*` / `node:*` behind feature
  checks with a portable fallback. A Node consumer must not be forced to build
  `bun-pty` (rust/ffi), and vice-versa.
- `bun-pty` is the default/tested backend. `node-pty` stays **experimental**
  (typed + documented) until the scale and auto-detect benchmarks gate it. Don't promote it
  without the data.
- Persist output to the headless terminal first (even with zero listeners).
  Reattach replays a **serialized** frame, never raw byte history. Clear old
  listeners before attaching new ones (prevents double output).
- Keep the collaborative room model: output broadcasts to a room (default =
  namespace), the client filters by `sessionId`, N clients ↔ 1 session.
- `authorize` is enforced (create/attach/write/resize/kill) with anti-hijack
  ownership checks. It defaults to allow-all for DX — keep the production warning
  loud in docs.
- The library core stays silent. No stdout/stderr writes; route diagnostics
  through the injectable logger (off by default).
- Use ESM imports with explicit `.js` specifiers. Don't loosen the compiler or
  lint settings to make a change pass.
- Don't overwrite unrelated user changes — check `git status` first.

---

## Current Architecture

- `src/index.ts` — main entry barrel (core + server).
- `src/core/` — `PtyKit` session manager (`Map<sessionId, Session>`, idempotent
  create, no idle TTL by default, retain-exited); `PtyBackend` interface +
  `bun-pty`/`node-pty` adapters + auto-detect; output pipeline (persist-first,
  micro-task batching, monotonic `seq`, multi-listener fan-out); scrollback via
  `@xterm/headless` + `@xterm/addon-serialize`; reattach (three paths); lifecycle
  (idle `\r` fallback, kill semantics).
- `src/server/` — `createPtyKitServer`: WS transport over Bun.serve & Node
  http.Server; rooms/broadcast; `authorize`; full RPC operation set + events.
- `src/client/index.ts` — `PtyKitClient` (reconnect/backoff/heal, idempotency-aware
  resend, `onStatus`), `attach`/`create`/`write`/`resize`/`detach`, `seq` dedup,
  `persistence` hook, `attachFit` (FitAddon + ResizeObserver, debounced).
- `src/client/svelte/` — `<PtyTerminal/>`; reactive status store.
- `src/shared/` — wire-protocol types, `seq`, `stripReportRequests`.
- `docs/`, `examples/`, `bench/` — public docs, runnable example, benchmark harness.

---

## Work Protocol

### Before Editing
- Inspect the relevant source and nearby tests.
- Use `rg` for search.
- Check `docs/` if the change touches public API behavior.

### While Editing
- Match local style: tabs, single quotes, semicolons, `const` by default.
- kebab-case files; `camelCase`/`PascalCase`/`UPPER_SNAKE_CASE` per the above.
- Add `bun:test` tests next to non-trivial logic (see the list in AGENTS.md).
- Keep `any` limited to the runtime boundary.
- Prefer focused changes over broad refactors.

### After Editing
```sh
bun run typecheck
bun run lint
bun run test
bun run build
```
For docs-only changes, say so and skip the code checks if nothing else changed.

---

## Public Surface Rules

- Public API changes → update `README.md` and `docs/api.md` (+ the matching
  `docs/server.md` / `docs/client.md` / `docs/svelte.md`).
- Keep examples aligned with the documented API.
- `README.md` may be dirty from user edits; don't overwrite unless required.
- Keep repository-facing text in English, following `CONTRIBUTING.md`.

---

## Verification Reference

- `bun run typecheck` — `tsc -p tsconfig.json --noEmit`
- `bun run lint` — ESLint flat config
- `bun run test` — `bun:test`
- `bun run build` — emit `dist/`
- `bun run prepublishOnly` — clean and build
