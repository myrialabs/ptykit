# Changelog

All notable changes to **ptykit** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

Initial release. PTY sessions over WebSocket for Node & Bun, with behavior
hardened against real-world collaborative terminal usage.

### Added

- **Core (`ptykit`)**
  - `PtyKit` session manager: idempotent `createSession` (R3), no idle TTL by
    default (`idleTtl: null`, R4), retain-exited window for reconnect
    (`retainExitedMs`, default 5 min, R8).
  - `PtyBackend` abstraction with `bun-pty` (tested) and `node-pty`
    (experimental) adapters and runtime auto-detect.
  - Shell spawn per platform (R1) and environment hygiene (R2).
  - Output pipeline: persist-to-headless-first (R7a), micro-task batching with a
    monotonic `seq` for dedup (R5), multi-listener fan-out.
  - Scrollback via `@xterm/headless` + `@xterm/addon-serialize` behind a
    `BufferStore` seam (R6).
  - Reattach via serialized replay across create/reconnect/missed-output, with
    clear-listeners-first (R7); idle `\r` fallback (R18); kill = Ctrl+C → SIGKILL
    (R19).
- **Server (`ptykit`)**
  - `createPtyKitServer`: WebSocket-only transport (R9) over `Bun.serve` and Node
    `http.Server` (via the optional `ws` package).
  - Collaborative rooms — output broadcasts to a room, filtered client-side by
    `sessionId`; N clients ↔ 1 session (R11).
  - `authorize` hook (create/attach/write/resize/kill) with anti-hijack ownership
    checks (R10). Defaults to allow-all for DX — **set it in production**.
  - Full operation set + events (R12).
- **Client (`ptykit/client`)**
  - `PtyKitClient` with reconnect (exp-backoff, default ON), heal-reconnect for
    "open but dead" sockets, idempotency-aware resend, and `onStatus` (R14).
  - `attach`/`create`/`write` (raw pass-through, R16)/`resize`/`detach`; `onData`
    deduped by `seq` with replay frames passed through `stripReportRequests`
    (R5/R17).
  - sessionId persistence (sessionStorage default, overridable hook; R13).
  - `attachFit` — FitAddon + ResizeObserver, debounced (R15).
- **Svelte (`ptykit/svelte`)**: `<PtyTerminal sessionId url />`.
- Benchmark harness (`bench/`) and results (`bench-results.md`).
- `examples/` — runnable scenarios for server, client, collaboration, auth,
  reconnect, Node mounting, and a browser xterm wiring.

### Notes

- **WebSocket only.** No SSE, no transport option — a deliberate decision.
- **node-pty is experimental.** `bun-pty` is the default, tested backend. On the
  benchmark machine (Node 25, macOS arm64) node-pty failed to spawn
  (`posix_spawnp`, reproduced with raw node-pty); the adapter ships but is not
  yet gated to "supported" (see `bench-results.md`).
