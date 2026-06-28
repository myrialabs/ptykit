# API Reference

The public surface of `ptykit`, split across three entry points.

## Entry points

| Import | Exports |
|---|---|
| `ptykit` | `PtyKit`, `createPtyKitServer`, wire-protocol types, `PTYKIT_VERSION`. |
| `ptykit/client` | `mountTerminal`, `PtyKitClient`, `ClientSession`, `attachFit`, `defaultPersistence`, `WsCore`. |
| `ptykit/svelte` | `PtyTerminal` (default + named). |

## `ptykit` (core + server)

- `PtyKit` — session manager. See [server.md](./server.md#ptykit).
- `createPtyKitServer(manager, options)` — WebSocket server. See
  [server.md](./server.md#createptykitserver).
- Backend: `loadBackend`, `detectBackendName`, `PtyBackend`, `PtyProcessHandle`.
- Scrollback seam: `BufferStore`, `MemoryBufferStore`.
- Env/shell: `buildPtyEnv`, `getCleanSpawnEnv`, `resolveShell`, `checkShell`.
- Wire types: `RpcMap`, `ServerEventMap`, `OutputEvent`, `Seq`, `stripReportRequests`, …

## `ptykit/client`

- `mountTerminal(target, options)` — ready-to-use xterm terminal wired to a
  session; returns a `{ client, session, terminal, fitAddon, dispose }` handle.
  See [client.md](./client.md#mountterminal--the-ready-to-use-path).
- `PtyKitClient` / `ClientSession` — see [client.md](./client.md).
- `attachFit(session, term, fitAddon, { debounceMs })` — see [client.md](./client.md#attachfit).
- `defaultPersistence()` / `SessionPersistence` — sessionId persistence.
- `WsCore` — the low-level resilient socket (advanced use).

## `ptykit/svelte`

- `PtyTerminal` — `<PtyTerminal sessionId url namespace? create? />`. See
  [svelte.md](./svelte.md).

## Behavior coverage

The collaborative room model, `authorize` enforcement + anti-hijack, serialized
reattach (zero data loss, no double output), reconnect/heal, and `seq` dedup all
have dedicated tests under `src/`.
